import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	createSubscription,
	deleteSubscription,
	getSubscription,
	getSubscriptionByName,
	listSubscriptions,
	notifySubscriptionsChanged,
	rotateSubscriptionSecret,
	toggleSubscriptionStatus,
	updateSubscription,
} from "@secondlayer/shared/db/queries/subscriptions";
import type {
	Subscription,
	SubscriptionFormat,
	SubscriptionRuntime,
} from "@secondlayer/shared/db";
import { replaySubscription } from "@secondlayer/subgraphs/runtime/replay";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

/**
 * Subscription CRUD routes — tenant-side. Writes are scoped by
 * `accountId` from the auth middleware. `signing_secret_enc` is never
 * returned; the plaintext `signingSecret` is surfaced exactly once
 * on create + rotate.
 */
const app = new Hono();

const VALID_FORMATS: SubscriptionFormat[] = [
	"standard-webhooks",
	"inngest",
	"trigger",
	"cloudflare",
	"cloudevents",
	"raw",
];

const VALID_RUNTIMES: SubscriptionRuntime[] = [
	"inngest",
	"trigger",
	"cloudflare",
	"node",
];

function toSummary(sub: Subscription) {
	return {
		id: sub.id,
		name: sub.name,
		status: sub.status,
		subgraphName: sub.subgraph_name,
		tableName: sub.table_name,
		format: sub.format,
		runtime: sub.runtime,
		url: sub.url,
		lastDeliveryAt: sub.last_delivery_at?.toISOString() ?? null,
		lastSuccessAt: sub.last_success_at?.toISOString() ?? null,
		createdAt: sub.created_at.toISOString(),
		updatedAt: sub.updated_at.toISOString(),
	};
}

function toDetail(sub: Subscription) {
	return {
		...toSummary(sub),
		filter: sub.filter as Record<string, unknown>,
		authConfig: sub.auth_config as Record<string, unknown>,
		maxRetries: sub.max_retries,
		timeoutMs: sub.timeout_ms,
		concurrency: sub.concurrency,
		circuitFailures: sub.circuit_failures,
		circuitOpenedAt: sub.circuit_opened_at?.toISOString() ?? null,
		lastError: sub.last_error,
	};
}

// ── GET /api/subscriptions ──────────────────────────────────────────────

app.get("/", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const rows = await listSubscriptions(getDb(), accountId);
	return c.json({ data: rows.map(toSummary) });
});

// ── POST /api/subscriptions ─────────────────────────────────────────────

app.post("/", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}

	const name = String(body.name ?? "").trim();
	const subgraphName = String(body.subgraphName ?? "").trim();
	const tableName = String(body.tableName ?? "").trim();
	const url = String(body.url ?? "").trim();
	if (!name || !subgraphName || !tableName || !url) {
		return c.json(
			{
				error:
					"Missing required fields: name, subgraphName, tableName, url",
			},
			400,
		);
	}

	const format =
		body.format !== undefined ? String(body.format) : "standard-webhooks";
	if (!VALID_FORMATS.includes(format as SubscriptionFormat)) {
		return c.json(
			{ error: `format must be one of: ${VALID_FORMATS.join(", ")}` },
			400,
		);
	}
	const runtime = body.runtime != null ? String(body.runtime) : null;
	if (runtime && !VALID_RUNTIMES.includes(runtime as SubscriptionRuntime)) {
		return c.json(
			{ error: `runtime must be one of: ${VALID_RUNTIMES.join(", ")}` },
			400,
		);
	}

	const existing = await getSubscriptionByName(getDb(), accountId, name);
	if (existing) {
		return c.json({ error: `Subscription "${name}" already exists` }, 409);
	}

	try {
		const { subscription, signingSecret } = await createSubscription(getDb(), {
			accountId,
			name,
			subgraphName,
			tableName,
			url,
			format: format as SubscriptionFormat,
			runtime: runtime as SubscriptionRuntime | null,
			filter:
				body.filter && typeof body.filter === "object" ? body.filter : {},
			authConfig:
				body.authConfig && typeof body.authConfig === "object"
					? body.authConfig
					: {},
			maxRetries:
				typeof body.maxRetries === "number" ? body.maxRetries : undefined,
			timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
			concurrency:
				typeof body.concurrency === "number" ? body.concurrency : undefined,
		});
		await notifySubscriptionsChanged(getDb(), accountId);
		return c.json(
			{ subscription: toDetail(subscription), signingSecret },
			201,
		);
	} catch (err) {
		logger.error("createSubscription failed", { error: getErrorMessage(err) });
		return c.json({ error: getErrorMessage(err) }, 500);
	}
});

// ── GET /api/subscriptions/:id ──────────────────────────────────────────

app.get("/:id", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const sub = await getSubscription(getDb(), accountId, id);
	if (!sub) return c.json({ error: "Subscription not found" }, 404);
	return c.json(toDetail(sub));
});

// ── PATCH /api/subscriptions/:id ────────────────────────────────────────

app.patch("/:id", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}

	if (body.format !== undefined) {
		if (!VALID_FORMATS.includes(String(body.format) as SubscriptionFormat)) {
			return c.json(
				{ error: `format must be one of: ${VALID_FORMATS.join(", ")}` },
				400,
			);
		}
	}
	if (
		body.runtime !== undefined &&
		body.runtime !== null &&
		!VALID_RUNTIMES.includes(String(body.runtime) as SubscriptionRuntime)
	) {
		return c.json(
			{ error: `runtime must be one of: ${VALID_RUNTIMES.join(", ")}` },
			400,
		);
	}

	const updated = await updateSubscription(getDb(), accountId, id, {
		name: typeof body.name === "string" ? body.name : undefined,
		url: typeof body.url === "string" ? body.url : undefined,
		format:
			body.format !== undefined
				? (String(body.format) as SubscriptionFormat)
				: undefined,
		runtime:
			body.runtime !== undefined
				? (body.runtime === null
						? null
						: (String(body.runtime) as SubscriptionRuntime))
				: undefined,
		filter:
			body.filter !== undefined && typeof body.filter === "object"
				? body.filter
				: undefined,
		authConfig:
			body.authConfig !== undefined && typeof body.authConfig === "object"
				? body.authConfig
				: undefined,
		maxRetries:
			typeof body.maxRetries === "number" ? body.maxRetries : undefined,
		timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
		concurrency:
			typeof body.concurrency === "number" ? body.concurrency : undefined,
	});
	if (!updated) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json(toDetail(updated));
});

// ── POST /api/subscriptions/:id/pause ───────────────────────────────────

app.post("/:id/pause", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const sub = await toggleSubscriptionStatus(
		getDb(),
		accountId,
		c.req.param("id"),
		"paused",
	);
	if (!sub) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json(toDetail(sub));
});

// ── POST /api/subscriptions/:id/resume ──────────────────────────────────

app.post("/:id/resume", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const sub = await toggleSubscriptionStatus(
		getDb(),
		accountId,
		c.req.param("id"),
		"active",
	);
	if (!sub) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json(toDetail(sub));
});

// ── POST /api/subscriptions/:id/rotate-secret ───────────────────────────

app.post("/:id/rotate-secret", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const result = await rotateSubscriptionSecret(
		getDb(),
		accountId,
		c.req.param("id"),
	);
	if (!result) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json({
		subscription: toDetail(result.subscription),
		signingSecret: result.signingSecret,
	});
});

// ── GET /api/subscriptions/:id/deliveries ───────────────────────────────

app.get("/:id/deliveries", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getSubscription(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Subscription not found" }, 404);

	const rows = await getDb()
		.selectFrom("subscription_deliveries")
		.selectAll()
		.where("subscription_id", "=", sub.id)
		.orderBy("dispatched_at", "desc")
		.limit(100)
		.execute();
	return c.json({
		data: rows.map((r) => ({
			id: r.id,
			attempt: r.attempt,
			statusCode: r.status_code,
			errorMessage: r.error_message,
			durationMs: r.duration_ms,
			responseBody: r.response_body,
			dispatchedAt: r.dispatched_at.toISOString(),
		})),
	});
});

// ── GET /api/subscriptions/:id/dead — DLQ preview ──────────────────────

app.get("/:id/dead", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getSubscription(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Subscription not found" }, 404);

	const rows = await getDb()
		.selectFrom("subscription_outbox")
		.selectAll()
		.where("subscription_id", "=", sub.id)
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

// ── POST /api/subscriptions/:id/dead/:outboxId/requeue ─────────────────

app.post("/:id/dead/:outboxId/requeue", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const sub = await getSubscription(getDb(), accountId, c.req.param("id"));
	if (!sub) return c.json({ error: "Subscription not found" }, 404);

	const res = await getDb()
		.updateTable("subscription_outbox")
		.set({
			status: "pending",
			attempt: 0,
			next_attempt_at: new Date(),
			failed_at: null,
			locked_by: null,
			locked_until: null,
		})
		.where("id", "=", c.req.param("outboxId"))
		.where("subscription_id", "=", sub.id)
		.where("status", "=", "dead")
		.executeTakeFirst();
	const ok = Number(res.numUpdatedRows ?? 0) > 0;
	if (!ok) return c.json({ error: "Dead row not found" }, 404);
	return c.json({ ok: true });
});

// ── POST /api/subscriptions/:id/replay ──────────────────────────────────

app.post("/:id/replay", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}
	const fromBlock = Number(body.fromBlock);
	const toBlock = Number(body.toBlock);
	if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock)) {
		return c.json(
			{ error: "fromBlock and toBlock required (numbers)" },
			400,
		);
	}

	try {
		const result = await replaySubscription({
			accountId,
			subscriptionId: c.req.param("id"),
			fromBlock,
			toBlock,
		});
		return c.json(result, 202);
	} catch (err) {
		const msg = getErrorMessage(err);
		const status = msg === "Subscription not found" ? 404 : 400;
		return c.json({ error: msg }, status);
	}
});

// ── DELETE /api/subscriptions/:id ───────────────────────────────────────

app.delete("/:id", async (c) => {
	const accountId = getAccountId(c);
	if (!accountId) return c.json({ error: "Unauthorized" }, 401);
	const ok = await deleteSubscription(getDb(), accountId, c.req.param("id"));
	if (!ok) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json({ ok: true });
});

export default app;
