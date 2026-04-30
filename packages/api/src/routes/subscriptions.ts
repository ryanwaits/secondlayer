import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import type { Subscription } from "@secondlayer/shared/db";
import { getSubgraph } from "@secondlayer/shared/db/queries/subgraphs";
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
import {
	CreateSubscriptionRequestSchema,
	ReplaySubscriptionRequestSchema,
	type SubscriptionSchemaTables,
	UpdateSubscriptionRequestSchema,
	formatSubscriptionSchemaErrors,
	validateSubscriptionFilterForTable,
} from "@secondlayer/shared/schemas/subscriptions";
import { replaySubscription } from "@secondlayer/subgraphs/runtime/replay";
import { Hono } from "hono";
import { getTenantScopedAccountId } from "../lib/request-scope.ts";
import { InvalidJSONError } from "../middleware/error.ts";

/**
 * Subscription CRUD routes. Platform mode scopes by accountId from auth.
 * Tenant/OSS modes use the local tenant DB namespace, where subgraphs and
 * subscriptions are stored with the empty account id.
 */
const app = new Hono();

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

function getDefinitionSchema(subgraph: {
	definition: Record<string, unknown>;
}): SubscriptionSchemaTables {
	const schema = subgraph.definition.schema;
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return {};
	}
	return schema as SubscriptionSchemaTables;
}

async function validateSubscriptionTarget(input: {
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
	return validateSubscriptionFilterForTable({
		subgraphName: input.subgraphName,
		tableName: input.tableName,
		filter: input.filter,
		tables: getDefinitionSchema(subgraph),
	});
}

// ── GET /api/subscriptions ──────────────────────────────────────────────

app.get("/", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const rows = await listSubscriptions(getDb(), accountId);
	return c.json({ data: rows.map(toSummary) });
});

// ── POST /api/subscriptions ─────────────────────────────────────────────

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

	const parsed = CreateSubscriptionRequestSchema.safeParse(body);
	if (!parsed.success) {
		const details = formatSubscriptionSchemaErrors(parsed.error);
		return c.json({ error: details.join("; "), details }, 400);
	}
	const input = parsed.data;

	const validationErrors = await validateSubscriptionTarget({
		accountId,
		subgraphName: input.subgraphName,
		tableName: input.tableName,
		filter: input.filter,
	});
	if (validationErrors.length > 0) {
		return c.json(
			{ error: validationErrors.join("; "), details: validationErrors },
			400,
		);
	}

	const existing = await getSubscriptionByName(getDb(), accountId, input.name);
	if (existing) {
		return c.json(
			{ error: `Subscription "${input.name}" already exists` },
			409,
		);
	}

	try {
		const { subscription, signingSecret } = await createSubscription(getDb(), {
			accountId,
			name: input.name,
			subgraphName: input.subgraphName,
			tableName: input.tableName,
			url: input.url,
			format: input.format,
			runtime: input.runtime ?? null,
			filter: input.filter ?? {},
			authConfig: input.authConfig ?? {},
			maxRetries: input.maxRetries,
			timeoutMs: input.timeoutMs,
			concurrency: input.concurrency,
		});
		await notifySubscriptionsChanged(getDb(), accountId);
		return c.json({ subscription: toDetail(subscription), signingSecret }, 201);
	} catch (err) {
		logger.error("createSubscription failed", { error: getErrorMessage(err) });
		return c.json({ error: getErrorMessage(err) }, 500);
	}
});

// ── GET /api/subscriptions/:id ──────────────────────────────────────────

app.get("/:id", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	const id = c.req.param("id");
	const sub = await getSubscription(getDb(), accountId, id);
	if (!sub) return c.json({ error: "Subscription not found" }, 404);
	return c.json(toDetail(sub));
});

// ── PATCH /api/subscriptions/:id ────────────────────────────────────────

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

	const parsed = UpdateSubscriptionRequestSchema.safeParse(body);
	if (!parsed.success) {
		const details = formatSubscriptionSchemaErrors(parsed.error);
		return c.json({ error: details.join("; "), details }, 400);
	}
	const patch = parsed.data;

	if (patch.filter !== undefined) {
		const current = await getSubscription(getDb(), accountId, id);
		if (!current) return c.json({ error: "Subscription not found" }, 404);
		const validationErrors = await validateSubscriptionTarget({
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

	const updated = await updateSubscription(getDb(), accountId, id, {
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
	if (!updated) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json(toDetail(updated));
});

// ── POST /api/subscriptions/:id/pause ───────────────────────────────────

app.post("/:id/pause", async (c) => {
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
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
			// Clear replay flag so a manual requeue drains at live priority,
			// not throttled through the 10% replay share.
			is_replay: false,
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);

	let body: Record<string, unknown>;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}
	const parsed = ReplaySubscriptionRequestSchema.safeParse(body);
	if (!parsed.success) {
		const details = formatSubscriptionSchemaErrors(parsed.error);
		return c.json({ error: details.join("; "), details }, 400);
	}
	const { fromBlock, toBlock, force } = parsed.data;

	try {
		const result = await replaySubscription({
			accountId,
			subscriptionId: c.req.param("id"),
			fromBlock,
			toBlock,
			replayIdSuffix: force,
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
	const accountId = getTenantScopedAccountId(c);
	if (accountId === null) return c.json({ error: "Unauthorized" }, 401);
	const ok = await deleteSubscription(getDb(), accountId, c.req.param("id"));
	if (!ok) return c.json({ error: "Subscription not found" }, 404);
	await notifySubscriptionsChanged(getDb(), accountId);
	return c.json({ ok: true });
});

export default app;
