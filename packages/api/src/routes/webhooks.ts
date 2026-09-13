import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import type { Webhook } from "@secondlayer/shared/db";
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
import { replayWebhook } from "@secondlayer/subgraphs/runtime/replay";
import { Hono } from "hono";
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
	"replay range exceeds 100k blocks",
	"replay is only supported for subgraph or chain webhooks",
];
const SUBGRAPH_NOT_REGISTERED_RE =
	/^Subgraph ".*" not registered — cannot replay its rows\. Deploy the subgraph first\.$/;

function isKnownReplayError(msg: string): boolean {
	return (
		KNOWN_REPLAY_ERRORS.includes(msg) || SUBGRAPH_NOT_REGISTERED_RE.test(msg)
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
			errorMessage: r.error_message,
			durationMs: r.duration_ms,
			responseBody: r.response_body,
			dispatchedAt: r.dispatched_at.toISOString(),
		})),
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
