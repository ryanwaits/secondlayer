import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import type { OutboxStatus, Webhook } from "@secondlayer/shared/db";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
import {
	createWebhook,
	deleteWebhook,
	getWebhook,
	getWebhookByName,
	listWebhooks,
	notifyWebhooksChanged,
	rotateWebhookSecret,
	toggleWebhookStatus,
	updateWebhook,
} from "@secondlayer/shared/db/queries/webhooks";
import {
	type ChainTrigger,
	CreateWebhookRequestSchema,
	ReplayWebhookRequestSchema,
	UpdateWebhookRequestSchema,
	type WebhookSchemaTables,
	formatWebhookSchemaErrors,
	validateWebhookFilterForTable,
} from "@secondlayer/shared/schemas/webhooks";
import { deliverTestEvent } from "@secondlayer/subgraphs/runtime/emitter";
import {
	ReplayInProgressError,
	replayWebhook,
} from "@secondlayer/subgraphs/runtime/replay";
import { Hono } from "hono";
import { sql } from "kysely";
import { getTenantScopedAccountId } from "../lib/request-scope.ts";
import { InvalidJSONError } from "../middleware/error.ts";

/**
 * Webhook CRUD routes. Platform mode scopes by accountId from auth.
 * Tenant/OSS modes use the local tenant DB namespace, where subgraphs and
 * webhooks are stored with the empty account id.
 */
const app = new Hono();

// Known, user-facing errors `replayWebhook` throws (see
// packages/subgraphs/src/runtime/replay.ts). Anything else may carry raw
// DB/driver detail, so it's genericized before reaching the client — the
// "Webhook not found" sentinel is handled separately (-> 404).
const KNOWN_REPLAY_ERRORS = [
	"fromBlock must be <= toBlock",
	"replay is only supported for subgraph or chain webhooks",
];
const SUBGRAPH_NOT_REGISTERED_RE =
	/^Subgraph ".*" not registered — cannot replay its rows\. Deploy the subgraph first\.$/;
// "replay range exceeds Nk blocks" (round thousands) or "replay range exceeds
// N blocks" (a `WEBHOOK_REPLAY_MAX_BLOCKS` override that isn't a clean
// multiple of 1000) — see `formatBlockCount` in runtime/replay.ts.
const REPLAY_RANGE_TOO_LARGE_RE = /^replay range exceeds \d+k? blocks$/;
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownReplayError(msg: string): boolean {
	return (
		KNOWN_REPLAY_ERRORS.includes(msg) ||
		SUBGRAPH_NOT_REGISTERED_RE.test(msg) ||
		REPLAY_RANGE_TOO_LARGE_RE.test(msg)
	);
}

function toSummary(sub: Webhook) {
	return {
		id: sub.id,
		name: sub.name,
		status: sub.status,
		kind: sub.kind,
		subgraphName: sub.subgraph_name,
		tableName: sub.table_name,
		format: sub.format,
		runtime: sub.runtime,
		url: sub.url,
		lastDeliveryAt: sub.last_delivery_at?.toISOString() ?? null,
		lastSuccessAt: sub.last_success_at?.toISOString() ?? null,
		// Circuit-breaker state: list views derive a "circuit-paused" count from
		// this, so it must be present on the summary (not just toDetail).
		circuitOpenedAt: sub.circuit_opened_at?.toISOString() ?? null,
		createdAt: sub.created_at.toISOString(),
		updatedAt: sub.updated_at.toISOString(),
	};
}

// The chain-trigger evaluator only runs when `SUBGRAPH_SOURCE=streams-index`
// (see `startWebhookPlane` in @secondlayer/subgraphs/runtime/webhook-plane).
// A `kind="chain"` webhook on any other instance is silently dead — no error,
// it just never fires — so surface it everywhere the webhook is read, not
// just at creation.
const CHAIN_EVALUATOR_IDLE_WARNING =
	"This instance's chain-trigger evaluator is not running (SUBGRAPH_SOURCE != \"streams-index\") — this chain webhook will never fire until that's set.";

function chainEvaluatorWarning(sub: Webhook): string | null {
	if (sub.kind !== "chain") return null;
	if (process.env.SUBGRAPH_SOURCE === "streams-index") return null;
	return CHAIN_EVALUATOR_IDLE_WARNING;
}

function toDetail(sub: Webhook) {
	return {
		...toSummary(sub),
		filter: sub.filter as Record<string, unknown>,
		triggers: (sub.triggers ?? null) as ChainTrigger[] | null,
		authConfig: sub.auth_config as Record<string, unknown>,
		maxRetries: sub.max_retries,
		timeoutMs: sub.timeout_ms,
		concurrency: sub.concurrency,
		circuitFailures: sub.circuit_failures,
		lastError: sub.last_error,
		warning: chainEvaluatorWarning(sub),
	};
}

function getDefinitionSchema(subgraph: {
	definition: Record<string, unknown>;
}): WebhookSchemaTables {
	const schema = subgraph.definition.schema;
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return {};
	}
	return schema as WebhookSchemaTables;
}

async function validateWebhookTarget(input: {
	accountId: string;
	subgraphName: string;
	tableName: string;
	filter?: unknown;
}): Promise<string[]> {
	const subgraph = await getSubgraph(
		getDb(),
		input.subgraphName,
		input.accountId,
	);
	if (!subgraph) {
		return [`Subgraph not found: ${input.subgraphName}`];
	}
	return validateWebhookFilterForTable({
		subgraphName: input.subgraphName,
		tableName: input.tableName,
		filter: input.filter,
		tables: getDefinitionSchema(subgraph),
	});
}

// ── GET /api/webhooks ──────────────────────────────────────────────

app.get("/", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const limit = Math.min(
		Math.max(Number.parseInt(c.req.query("_limit") ?? "50", 10) || 50, 1),
		200,
	);
	const offset = Math.max(
		Number.parseInt(c.req.query("_offset") ?? "0", 10) || 0,
		0,
	);
	const rows = await listWebhooks(getDb(), accountId, { limit, offset });
	return c.json({ data: rows.map(toSummary) });
});

// ── POST /api/webhooks ─────────────────────────────────────────────

app.post("/", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}

	const parsed = CreateWebhookRequestSchema.safeParse(body);
	if (!parsed.success) {
		const details = formatWebhookSchemaErrors(parsed.error);
		return c.json({ error: details.join("; "), details }, 400);
	}
	const input = parsed.data;
	// The schema guarantees exactly one mode: chain (triggers) XOR subgraph
	// (subgraphName + tableName). Chain webhooks match raw chain events and
	// have no subgraph table to validate a column filter against.
	const isChain = input.triggers !== undefined;

	if (!isChain) {
		const validationErrors = await validateWebhookTarget({
			accountId,
			// Non-chain mode guarantees both are present (schema refine).
			subgraphName: input.subgraphName as string,
			tableName: input.tableName as string,
			filter: input.filter,
		});
		if (validationErrors.length > 0) {
			return c.json(
				{ error: validationErrors.join("; "), details: validationErrors },
				400,
			);
		}
	}

	const existing = await getWebhookByName(getDb(), accountId, input.name);
	if (existing) {
		return c.json({ error: `Webhook "${input.name}" already exists` }, 409);
	}

	try {
		const { webhook, signingSecret } = await createWebhook(getDb(), {
			accountId,
			name: input.name,
			kind: isChain ? "chain" : "subgraph",
			subgraphName: isChain ? null : input.subgraphName,
			tableName: isChain ? null : input.tableName,
			triggers: isChain ? input.triggers : undefined,
			url: input.url,
			format: input.format,
			runtime: input.runtime ?? null,
			filter: isChain ? {} : (input.filter ?? {}),
			authConfig: input.authConfig ?? {},
			maxRetries: input.maxRetries,
			timeoutMs: input.timeoutMs,
			concurrency: input.concurrency,
		});
		await notifyWebhooksChanged(getDb(), accountId);
		return c.json({ webhook: toDetail(webhook), signingSecret }, 201);
	} catch (err) {
		logger.error("createWebhook failed", { error: getErrorMessage(err) });
		return c.json(
			{ error: "Internal Server Error", code: "INTERNAL_ERROR" },
			500,
		);
	}
});

// ── GET /api/webhooks/:id ──────────────────────────────────────────

app.get("/:id", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const sub = await getWebhook(getDb(), accountId, id);
	if (!sub) return c.json({ error: "Webhook not found" }, 404);
	return c.json(toDetail(sub));
});

// ── PATCH /api/webhooks/:id ────────────────────────────────────────

app.patch("/:id", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}

	const parsed = UpdateWebhookRequestSchema.safeParse(body);
	if (!parsed.success) {
		const details = formatWebhookSchemaErrors(parsed.error);
		return c.json({ error: details.join("; "), details }, 400);
	}
	const patch = parsed.data;

	if (patch.filter !== undefined) {
		const current = await getWebhook(getDb(), accountId, id);
		if (!current) return c.json({ error: "Webhook not found" }, 404);
		// `filter` is a subgraph-table column filter; chain webhooks use
		// `triggers` instead, so there's nothing to validate against a table here.
		if (
			current.kind === "subgraph" &&
			current.subgraph_name &&
			current.table_name
		) {
			const validationErrors = await validateWebhookTarget({
				accountId,
				subgraphName: current.subgraph_name,
				tableName: current.table_name,
				filter: patch.filter,
			});
			if (validationErrors.length > 0) {
				return c.json(
					{ error: validationErrors.join("; "), details: validationErrors },
					400,
				);
			}
		}
	}

	const updated = await updateWebhook(getDb(), accountId, id, {
		name: patch.name,
		url: patch.url,
		format: patch.format,
		runtime: patch.runtime,
		filter: patch.filter,
		authConfig: patch.authConfig,
		maxRetries: patch.maxRetries,
		timeoutMs: patch.timeoutMs,
		concurrency: patch.concurrency,
	});
	if (!updated) return c.json({ error: "Webhook not found" }, 404);
	await notifyWebhooksChanged(getDb(), accountId);
	return c.json(toDetail(updated));
});

// ── POST /api/webhooks/:id/pause ───────────────────────────────────

app.post("/:id/pause", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await toggleWebhookStatus(
		getDb(),
		accountId,
		c.req.param("id"),
		"paused",
	);
	if (!sub) return c.json({ error: "Webhook not found" }, 404);
	await notifyWebhooksChanged(getDb(), accountId);
	return c.json(toDetail(sub));
});

// ── POST /api/webhooks/:id/resume ──────────────────────────────────

app.post("/:id/resume", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await toggleWebhookStatus(
		getDb(),
		accountId,
		c.req.param("id"),
		"active",
	);
	if (!sub) return c.json({ error: "Webhook not found" }, 404);
	await notifyWebhooksChanged(getDb(), accountId);
	return c.json(toDetail(sub));
});

// ── POST /api/webhooks/:id/rotate-secret ───────────────────────────

app.post("/:id/rotate-secret", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const result = await rotateWebhookSecret(
		getDb(),
		accountId,
		c.req.param("id"),
	);
	if (!result) return c.json({ error: "Webhook not found" }, 404);
	await notifyWebhooksChanged(getDb(), accountId);
	return c.json({
		webhook: toDetail(result.webhook),
		signingSecret: result.signingSecret,
	});
});

// Send a one-off test webhook to the webhook's URL (built for its configured
// format, SSRF-guarded) and log it as a delivery row (null outbox_id) so it shows
// up under the webhook's deliveries.
app.post("/:id/test", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getWebhook(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Webhook not found" }, 404);
	const result = await deliverTestEvent(getDb(), sub);
	return c.json(result);
});

// ── GET /api/webhooks/:id/deliveries ───────────────────────────────

app.get("/:id/deliveries", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getWebhook(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Webhook not found" }, 404);

	const db = getDb();
	const [rows, totalRow] = await Promise.all([
		db
			.selectFrom("webhook_deliveries as d")
			.leftJoin("webhook_outbox as o", "o.id", "d.outbox_id")
			.select([
				"d.id",
				"d.attempt",
				"d.status_code",
				"d.error_message",
				"d.duration_ms",
				"d.response_body",
				"d.dispatched_at",
				"o.block_height",
				"o.block_time",
			])
			.where("d.webhook_id", "=", sub.id)
			.orderBy("d.dispatched_at", "desc")
			.limit(100)
			.execute(),
		db
			.selectFrom("webhook_deliveries")
			.select(db.fn.countAll<string>().as("n"))
			.where("webhook_id", "=", sub.id)
			.executeTakeFirst(),
	]);
	// `seq` numbers deliveries newest-first from the lifetime total, so the log
	// reads like a ledger (#4,182 …) even though only the last 100 are returned.
	const total = Number(totalRow?.n ?? rows.length);
	return c.json({
		total,
		data: rows.map((r, i) => ({
			id: r.id,
			seq: total - i,
			attempt: r.attempt,
			statusCode: r.status_code,
			// Null when the outbox row was already compacted away.
			blockHeight: r.block_height === null ? null : Number(r.block_height),
			// Null when the outbox row is gone, or predates the block_time column.
			blockTime: r.block_time === null ? null : r.block_time.toISOString(),
			errorMessage: r.error_message,
			durationMs: r.duration_ms,
			responseBody: r.response_body,
			dispatchedAt: r.dispatched_at.toISOString(),
		})),
	});
});

// ── GET /api/webhooks/:id/activity ─────────────────────────────────
// Hourly delivered/waiting/gave-up counts over the last 7 days (zero-filled
// to 168 hours), plus the current queue depth — the events chart and the
// catch-up bar on the detail page poll this. One query over `webhook_outbox`
// keyed on (webhook_id, created_at), matching the `outbox_sub_idx` index.

const ACTIVITY_HOURS = 168;
const ACTIVITY_KEY_BY_STATUS: Record<
	OutboxStatus,
	"delivered" | "waiting" | "gaveUp"
> = {
	delivered: "delivered",
	pending: "waiting",
	dead: "gaveUp",
};

/** `count` hour-aligned UTC ISO timestamps, oldest first, ending on the
 *  current (partial) hour. */
function hourBucketsUtc(now: Date, count: number): string[] {
	const currentHourMs = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
	const buckets: string[] = [];
	for (let i = count - 1; i >= 0; i--) {
		buckets.push(new Date(currentHourMs - i * 3_600_000).toISOString());
	}
	return buckets;
}

app.get("/:id/activity", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getWebhook(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Webhook not found" }, 404);

	const db = getDb();
	const [grouped, waitingRow, nextAttemptRow, lastSuccessRow] =
		await Promise.all([
			db
				.selectFrom("webhook_outbox")
				.select([
					// `AT TIME ZONE 'UTC'` on both sides makes the truncation a UTC
					// hour boundary regardless of the session's timezone setting.
					sql<Date>`date_trunc('hour', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.as(
						"hour",
					),
					"status",
					db.fn.countAll<string>().as("n"),
				])
				.where("webhook_id", "=", sub.id)
				.where("created_at", ">=", sql<Date>`now() - interval '168 hours'`)
				.groupBy(
					sql`date_trunc('hour', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
				)
				.groupBy("status")
				.execute(),
			db
				.selectFrom("webhook_outbox")
				.select(db.fn.countAll<string>().as("n"))
				.where("webhook_id", "=", sub.id)
				.where("status", "=", "pending")
				.executeTakeFirst(),
			db
				.selectFrom("webhook_outbox")
				.select(({ fn }) => fn.min("next_attempt_at").as("next_attempt_at"))
				.where("webhook_id", "=", sub.id)
				.where("status", "=", "pending")
				.executeTakeFirst(),
			db
				.selectFrom("webhook_deliveries")
				.select(({ fn }) => fn.max("dispatched_at").as("dispatched_at"))
				.where("webhook_id", "=", sub.id)
				.where("status_code", ">=", 200)
				.where("status_code", "<", 300)
				.executeTakeFirst(),
		]);

	const byHour = new Map<
		string,
		{ delivered: number; waiting: number; gaveUp: number }
	>();
	for (const row of grouped) {
		const hourIso = row.hour.toISOString();
		const key = ACTIVITY_KEY_BY_STATUS[row.status as OutboxStatus];
		const bucket = byHour.get(hourIso) ?? {
			delivered: 0,
			waiting: 0,
			gaveUp: 0,
		};
		bucket[key] += Number(row.n);
		byHour.set(hourIso, bucket);
	}

	const hours = hourBucketsUtc(new Date(), ACTIVITY_HOURS).map((hour) => ({
		hour,
		...(byHour.get(hour) ?? { delivered: 0, waiting: 0, gaveUp: 0 }),
	}));

	return c.json({
		hours,
		waiting: Number(waitingRow?.n ?? 0),
		nextAttemptAt: nextAttemptRow?.next_attempt_at
			? (nextAttemptRow.next_attempt_at as Date).toISOString()
			: null,
		lastSuccessAt: lastSuccessRow?.dispatched_at
			? (lastSuccessRow.dispatched_at as Date).toISOString()
			: null,
	});
});

// ── GET /api/webhooks/:id/deliveries/:deliveryId — one attempt ────
// The delivery card's data: the delivery row plus its outbox context
// (payload, event/tx/block info), left-joined since the outbox row may
// already be compacted away (7-day retention on delivered rows).

app.get("/:id/deliveries/:deliveryId", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getWebhook(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Webhook not found" }, 404);

	const deliveryId = c.req.param("deliveryId");
	if (!UUID_RE.test(deliveryId)) {
		return c.json({ error: "deliveryId must be a UUID" }, 400);
	}

	const row = await getDb()
		.selectFrom("webhook_deliveries as d")
		.leftJoin("webhook_outbox as o", "o.id", "d.outbox_id")
		.select([
			"d.id",
			"d.attempt",
			"d.status_code",
			"d.duration_ms",
			"d.dispatched_at",
			"d.error_message",
			"d.response_body",
			"d.response_headers",
			"d.outbox_id",
			"o.event_type",
			"o.tx_id",
			"o.block_height",
			"o.block_time",
			"o.payload",
		])
		.where("d.id", "=", deliveryId)
		.where("d.webhook_id", "=", sub.id)
		.executeTakeFirst();
	if (!row) return c.json({ error: "Delivery not found" }, 404);

	return c.json({
		id: row.id,
		attempt: row.attempt,
		statusCode: row.status_code,
		durationMs: row.duration_ms,
		dispatchedAt: row.dispatched_at.toISOString(),
		errorMessage: row.error_message,
		responseBody: row.response_body,
		responseHeaders: row.response_headers,
		outboxId: row.outbox_id,
		eventType: row.event_type,
		txId: row.tx_id,
		blockHeight: row.block_height === null ? null : Number(row.block_height),
		blockTime: row.block_time === null ? null : row.block_time.toISOString(),
		payload: row.payload ?? null,
	});
});

// ── GET /api/webhooks/:id/dead — DLQ preview ──────────────────────

app.get("/:id/dead", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getWebhook(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Webhook not found" }, 404);

	const rows = await getDb()
		.selectFrom("webhook_outbox")
		.selectAll()
		.where("webhook_id", "=", sub.id)
		.where("status", "=", "dead")
		.orderBy("failed_at", "desc")
		.limit(100)
		.execute();
	return c.json({
		data: rows.map((r) => ({
			id: r.id,
			eventType: r.event_type,
			attempt: r.attempt,
			blockHeight: Number(r.block_height),
			txId: r.tx_id,
			payload: r.payload,
			failedAt: r.failed_at?.toISOString() ?? null,
			createdAt: r.created_at.toISOString(),
		})),
	});
});

// ── POST /api/webhooks/:id/dead/:outboxId/requeue ─────────────────

app.post("/:id/dead/:outboxId/requeue", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getWebhook(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Webhook not found" }, 404);

	const res = await getDb()
		.updateTable("webhook_outbox")
		.set({
			status: "pending",
			attempt: 0,
			next_attempt_at: new Date(),
			failed_at: null,
			locked_by: null,
			locked_until: null,
			// Clear replay flag so a manual requeue drains at live priority,
			// not throttled through the 10% replay share.
			is_replay: false,
		})
		.where("id", "=", c.req.param("outboxId"))
		.where("webhook_id", "=", sub.id)
		.where("status", "=", "dead")
		.executeTakeFirst();
	const ok = Number(res.numUpdatedRows ?? 0) > 0;
	if (!ok) return c.json({ error: "Dead row not found" }, 404);
	return c.json({ ok: true });
});

// ── POST /api/webhooks/:id/replay ──────────────────────────────────

app.post("/:id/replay", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}
	const parsed = ReplayWebhookRequestSchema.safeParse(body);
	if (!parsed.success) {
		const details = formatWebhookSchemaErrors(parsed.error);
		return c.json({ error: details.join("; "), details }, 400);
	}
	const { fromBlock, toBlock, force } = parsed.data;

	try {
		const result = await replayWebhook({
			accountId,
			webhookId: c.req.param("id"),
			fromBlock,
			toBlock,
			replayIdSuffix: force,
		});
		return c.json(result, 202);
	} catch (err) {
		if (err instanceof ReplayInProgressError) {
			return c.json({ error: err.message }, 409);
		}
		const msg = getErrorMessage(err);
		if (msg === "Webhook not found") {
			return c.json({ error: msg }, 404);
		}
		if (isKnownReplayError(msg)) {
			return c.json({ error: msg }, 400);
		}
		logger.error("replayWebhook failed", { error: msg });
		return c.json(
			{ error: "Internal Server Error", code: "INTERNAL_ERROR" },
			500,
		);
	}
});

// ── DELETE /api/webhooks/:id ───────────────────────────────────────

app.delete("/:id", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const ok = await deleteWebhook(getDb(), accountId, c.req.param("id"));
	if (!ok) return c.json({ error: "Webhook not found" }, 404);
	await notifyWebhooksChanged(getDb(), accountId);
	return c.json({ ok: true });
});

export default app;
