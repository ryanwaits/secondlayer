import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	ChainTrigger,
	CreateWebhookRequest,
	UpdateWebhookRequest,
} from "@secondlayer/sdk";
import { CHAIN_TRIGGER_TYPES } from "@secondlayer/shared";
import { z } from "zod";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type WebhookClientProvider = typeof getClient;

/**
 * Webhook MCP tools — let agents list, configure, test, and replay
 * webhook delivery. Mirrors the HTTP API 1:1; structured errors bubble
 * through the SDK's ApiError. `subscriptions_*` names are deprecated aliases.
 */
export function registerWebhookTools(
	server: McpServer,
	clientProvider: WebhookClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"webhooks_list",
		"List all webhooks for the current account. Returns summary fields (no secrets).",
		{},
		async () => {
			const { data } = await clientProvider().webhooks.list();
			return jsonResponse(data);
		},
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_get",
		"Get full detail for a webhook (filter, auth, retry config, circuit state).",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => {
			const detail = await clientProvider().webhooks.get(id);
			return jsonResponse(detail);
		},
	);
	defineTool<{
		name: string;
		subgraphName?: string;
		tableName?: string;
		triggers?: ChainTrigger[];
		url: string;
		format?:
			| "standard-webhooks"
			| "inngest"
			| "trigger"
			| "cloudflare"
			| "cloudevents"
			| "raw";
		runtime?: "inngest" | "trigger" | "cloudflare" | "node";
		filter?: Record<string, unknown>;
		authConfig?: Record<string, unknown>;
	}>(
		server,
		"webhooks_create",
		"Create a webhook. Two kinds (mutually exclusive): a SUBGRAPH webhook fires on a subgraph table's rows (set subgraphName + tableName + optional filter); a CHAIN webhook fires on raw chain events with no subgraph (set triggers). Returns `signingSecret` ONCE — forward it to the user so they can wire it into their receiver.",
		{
			name: z.string().describe("Human-readable name, unique per account"),
			subgraphName: z
				.string()
				.optional()
				.describe("Subgraph to subscribe to (subgraph webhook)"),
			tableName: z
				.string()
				.optional()
				.describe("Table within the subgraph (subgraph webhook)"),
			triggers: z
				.array(
					z.object({
						type: z.enum(CHAIN_TRIGGER_TYPES),
						contractId: z.string().optional(),
						functionName: z.string().optional(),
						caller: z.string().optional(),
						sender: z.string().optional(),
						recipient: z.string().optional(),
						assetIdentifier: z.string().optional(),
						deployer: z.string().optional(),
						contractName: z.string().optional(),
						topic: z.string().optional(),
						lockedAddress: z.string().optional(),
						trait: z.string().optional(),
						minAmount: z.union([z.string(), z.number()]).optional(),
						maxAmount: z.union([z.string(), z.number()]).optional(),
					}),
				)
				.optional()
				.describe(
					"Chain triggers (chain webhook) — provide INSTEAD of subgraphName/tableName. Each targets a raw chain event/tx; string fields accept `*` wildcards, `trait` scopes to a SIP/trait. Per-type accepted fields: see the secondlayer://chain-triggers resource. Forward-looking: starts at chain tip, no backfill.",
				),
			url: z.string().describe("Webhook URL"),
			format: z
				.enum([
					"standard-webhooks",
					"inngest",
					"trigger",
					"cloudflare",
					"cloudevents",
					"raw",
				])
				.optional()
				.describe("Wire format (default standard-webhooks)"),
			runtime: z
				.enum(["inngest", "trigger", "cloudflare", "node"])
				.optional()
				.describe("Receiver runtime label (display only)"),
			filter: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					'Scalar filter DSL, e.g. {"amount": {"gte": 100}, "sender": "SP..."}',
				),
			authConfig: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					'Receiver auth sent with each delivery, e.g. {"type": "bearer", "token": "..."}',
				),
		},
		async (input) => {
			const res = await clientProvider().webhooks.create(
				input as CreateWebhookRequest,
			);
			return jsonResponse(res);
		},
	);
	defineTool<{
		id: string;
		name?: string;
		url?: string;
		filter?: Record<string, unknown>;
		authConfig?: Record<string, unknown>;
		format?:
			| "standard-webhooks"
			| "inngest"
			| "trigger"
			| "cloudflare"
			| "cloudevents"
			| "raw";
		runtime?: "inngest" | "trigger" | "cloudflare" | "node" | null;
		maxRetries?: number;
		timeoutMs?: number;
		concurrency?: number;
	}>(
		server,
		"webhooks_update",
		"Patch a webhook (name, url, filter, authConfig, format, runtime, retry, timeout, concurrency).",
		{
			id: z.string(),
			name: z.string().optional().describe("Rename the webhook"),
			url: z.string().optional(),
			filter: z.record(z.string(), z.unknown()).optional(),
			authConfig: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Receiver auth sent with each delivery (bearer/etc.)"),
			format: z
				.enum([
					"standard-webhooks",
					"inngest",
					"trigger",
					"cloudflare",
					"cloudevents",
					"raw",
				])
				.optional(),
			runtime: z
				.enum(["inngest", "trigger", "cloudflare", "node"])
				.nullable()
				.optional(),
			maxRetries: z.number().int().min(0).optional(),
			timeoutMs: z.number().int().min(100).optional(),
			concurrency: z.number().int().min(1).optional(),
		},
		async ({ id, ...patch }) => {
			const res = await clientProvider().webhooks.update(
				id,
				patch as UpdateWebhookRequest,
			);
			return jsonResponse(res);
		},
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_delete",
		"Delete a webhook. Pending outbox rows are cascade-deleted.",
		{ id: z.string() },
		async ({ id }) => {
			const res = await clientProvider().webhooks.delete(id);
			return jsonResponse(res);
		},
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_test",
		"Send a one-off test webhook to a webhook's URL (built for its format, SSRF-guarded). Logged as a delivery row. Returns {ok, statusCode, error, durationMs, deliveryId}.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => {
			const res = await clientProvider().webhooks.test(id);
			return jsonResponse(res);
		},
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_pause",
		"Pause a webhook: stops delivery attempts and stops queueing new ones. Nothing is deleted — resume picks the webhook back up from the tip. Verify with webhooks_get (status).",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => jsonResponse(await clientProvider().webhooks.pause(id)),
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_resume",
		"Resume a paused webhook (also clears a tripped circuit breaker). Deliveries restart from the current tip — use webhooks_replay for the blocks missed while paused. Verify with webhooks_get (status).",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => jsonResponse(await clientProvider().webhooks.resume(id)),
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_rotate_secret",
		"Rotate a webhook's signing secret. Returns the NEW `signingSecret` ONCE — forward it to the user; deliveries signed with the old secret stop verifying as soon as this returns, so the receiver must be updated.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) =>
			jsonResponse(await clientProvider().webhooks.rotateSecret(id)),
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_deliveries",
		"List recent delivery attempts for a webhook — status code, attempt count, error, duration, timestamps. THIS IS THE VERIFY CALL: after webhooks_create, webhooks_test, or webhooks_replay, read it to confirm the webhook actually landed (and to see the receiver's response when it didn't) instead of trusting the enqueue result.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) =>
			jsonResponse(await clientProvider().webhooks.deliveries(id)),
	);
	defineTool<{ id: string }>(
		server,
		"webhooks_dead",
		"List a webhook's dead-letter queue — deliveries that exhausted their retries, with the outbox id, payload, and last error. Diagnose the receiver first (webhooks_get for the URL/auth, webhooks_test for a live probe), then requeue rows with webhooks_requeue.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => jsonResponse(await clientProvider().webhooks.dead(id)),
	);
	defineTool<{ id: string; outboxId: string }>(
		server,
		"webhooks_requeue",
		"Requeue ONE dead-lettered delivery for another attempt, by its outbox id from webhooks_dead. Fix the receiver first — a requeue against a still-broken endpoint just dies again. Verify with webhooks_deliveries.",
		{
			id: z.string().describe("Webhook id"),
			outboxId: z
				.string()
				.describe("Outbox id of the dead delivery (from webhooks_dead)"),
		},
		async ({ id, outboxId }) =>
			jsonResponse(await clientProvider().webhooks.requeue(id, outboxId)),
	);
	defineTool<{
		id: string;
		fromBlock: number;
		toBlock: number;
		force?: string;
	}>(
		server,
		"webhooks_replay",
		"Replay a block range for a webhook. Replays run at 10% of batch capacity — use sparingly. Pass `force` (a short idempotency suffix) to re-run a range that was already replayed.",
		{
			id: z.string(),
			fromBlock: z.number().int().nonnegative(),
			toBlock: z.number().int().nonnegative(),
			force: z
				.string()
				.optional()
				.describe(
					"Idempotency suffix to force a duplicate replay of the range",
				),
		},
		async ({ id, fromBlock, toBlock, force }) => {
			const res = await clientProvider().webhooks.replay(id, {
				fromBlock,
				toBlock,
				...(force !== undefined ? { force } : {}),
			});
			return jsonResponse(res);
		},
	);

	// Deprecated subscriptions_* aliases; removed in plan 015.
	defineTool<Record<string, never>>(
		server,
		"subscriptions_list", // deprecated alias
		"Deprecated alias of webhooks_list. Removed next minor. List all webhooks for the current account. Returns summary fields (no secrets).",
		{},
		async () => {
			const { data } = await clientProvider().webhooks.list();
			return jsonResponse(data);
		},
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_get", // deprecated alias
		"Deprecated alias of webhooks_get. Removed next minor. Get full detail for a webhook (filter, auth, retry config, circuit state).",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => {
			const detail = await clientProvider().webhooks.get(id);
			return jsonResponse(detail);
		},
	);
	defineTool<{
		name: string;
		subgraphName?: string;
		tableName?: string;
		triggers?: ChainTrigger[];
		url: string;
		format?:
			| "standard-webhooks"
			| "inngest"
			| "trigger"
			| "cloudflare"
			| "cloudevents"
			| "raw";
		runtime?: "inngest" | "trigger" | "cloudflare" | "node";
		filter?: Record<string, unknown>;
		authConfig?: Record<string, unknown>;
	}>(
		server,
		"subscriptions_create", // deprecated alias
		"Deprecated alias of webhooks_create. Removed next minor. Create a webhook. Two kinds (mutually exclusive): a SUBGRAPH webhook fires on a subgraph table's rows (set subgraphName + tableName + optional filter); a CHAIN webhook fires on raw chain events with no subgraph (set triggers). Returns `signingSecret` ONCE — forward it to the user so they can wire it into their receiver.",
		{
			name: z.string().describe("Human-readable name, unique per account"),
			subgraphName: z
				.string()
				.optional()
				.describe("Subgraph to subscribe to (subgraph webhook)"),
			tableName: z
				.string()
				.optional()
				.describe("Table within the subgraph (subgraph webhook)"),
			triggers: z
				.array(
					z.object({
						type: z.enum(CHAIN_TRIGGER_TYPES),
						contractId: z.string().optional(),
						functionName: z.string().optional(),
						caller: z.string().optional(),
						sender: z.string().optional(),
						recipient: z.string().optional(),
						assetIdentifier: z.string().optional(),
						deployer: z.string().optional(),
						contractName: z.string().optional(),
						topic: z.string().optional(),
						lockedAddress: z.string().optional(),
						trait: z.string().optional(),
						minAmount: z.union([z.string(), z.number()]).optional(),
						maxAmount: z.union([z.string(), z.number()]).optional(),
					}),
				)
				.optional()
				.describe(
					"Chain triggers (chain webhook) — provide INSTEAD of subgraphName/tableName. Each targets a raw chain event/tx; string fields accept `*` wildcards, `trait` scopes to a SIP/trait. Per-type accepted fields: see the secondlayer://chain-triggers resource. Forward-looking: starts at chain tip, no backfill.",
				),
			url: z.string().describe("Webhook URL"),
			format: z
				.enum([
					"standard-webhooks",
					"inngest",
					"trigger",
					"cloudflare",
					"cloudevents",
					"raw",
				])
				.optional()
				.describe("Wire format (default standard-webhooks)"),
			runtime: z
				.enum(["inngest", "trigger", "cloudflare", "node"])
				.optional()
				.describe("Receiver runtime label (display only)"),
			filter: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					'Scalar filter DSL, e.g. {"amount": {"gte": 100}, "sender": "SP..."}',
				),
			authConfig: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					'Receiver auth sent with each delivery, e.g. {"type": "bearer", "token": "..."}',
				),
		},
		async (input) => {
			const res = await clientProvider().webhooks.create(
				input as CreateWebhookRequest,
			);
			return jsonResponse(res);
		},
	);
	defineTool<{
		id: string;
		name?: string;
		url?: string;
		filter?: Record<string, unknown>;
		authConfig?: Record<string, unknown>;
		format?:
			| "standard-webhooks"
			| "inngest"
			| "trigger"
			| "cloudflare"
			| "cloudevents"
			| "raw";
		runtime?: "inngest" | "trigger" | "cloudflare" | "node" | null;
		maxRetries?: number;
		timeoutMs?: number;
		concurrency?: number;
	}>(
		server,
		"subscriptions_update", // deprecated alias
		"Deprecated alias of webhooks_update. Removed next minor. Patch a webhook (name, url, filter, authConfig, format, runtime, retry, timeout, concurrency).",
		{
			id: z.string(),
			name: z.string().optional().describe("Rename the webhook"),
			url: z.string().optional(),
			filter: z.record(z.string(), z.unknown()).optional(),
			authConfig: z
				.record(z.string(), z.unknown())
				.optional()
				.describe("Receiver auth sent with each delivery (bearer/etc.)"),
			format: z
				.enum([
					"standard-webhooks",
					"inngest",
					"trigger",
					"cloudflare",
					"cloudevents",
					"raw",
				])
				.optional(),
			runtime: z
				.enum(["inngest", "trigger", "cloudflare", "node"])
				.nullable()
				.optional(),
			maxRetries: z.number().int().min(0).optional(),
			timeoutMs: z.number().int().min(100).optional(),
			concurrency: z.number().int().min(1).optional(),
		},
		async ({ id, ...patch }) => {
			const res = await clientProvider().webhooks.update(
				id,
				patch as UpdateWebhookRequest,
			);
			return jsonResponse(res);
		},
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_delete", // deprecated alias
		"Deprecated alias of webhooks_delete. Removed next minor. Delete a webhook. Pending outbox rows are cascade-deleted.",
		{ id: z.string() },
		async ({ id }) => {
			const res = await clientProvider().webhooks.delete(id);
			return jsonResponse(res);
		},
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_test", // deprecated alias
		"Deprecated alias of webhooks_test. Removed next minor. Send a one-off test webhook to a webhook's URL (built for its format, SSRF-guarded). Logged as a delivery row. Returns {ok, statusCode, error, durationMs, deliveryId}.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => {
			const res = await clientProvider().webhooks.test(id);
			return jsonResponse(res);
		},
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_pause", // deprecated alias
		"Deprecated alias of webhooks_pause. Removed next minor. Pause a webhook: stops delivery attempts and stops queueing new ones. Nothing is deleted — resume picks the webhook back up from the tip. Verify with webhooks_get (status).",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => jsonResponse(await clientProvider().webhooks.pause(id)),
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_resume", // deprecated alias
		"Deprecated alias of webhooks_resume. Removed next minor. Resume a paused webhook (also clears a tripped circuit breaker). Deliveries restart from the current tip — use webhooks_replay for the blocks missed while paused. Verify with webhooks_get (status).",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => jsonResponse(await clientProvider().webhooks.resume(id)),
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_rotate_secret", // deprecated alias
		"Deprecated alias of webhooks_rotate_secret. Removed next minor. Rotate a webhook's signing secret. Returns the NEW `signingSecret` ONCE — forward it to the user; deliveries signed with the old secret stop verifying as soon as this returns, so the receiver must be updated.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) =>
			jsonResponse(await clientProvider().webhooks.rotateSecret(id)),
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_deliveries", // deprecated alias
		"Deprecated alias of webhooks_deliveries. Removed next minor. List recent delivery attempts for a webhook — status code, attempt count, error, duration, timestamps. THIS IS THE VERIFY CALL: after webhooks_create, webhooks_test, or webhooks_replay, read it to confirm the webhook actually landed (and to see the receiver's response when it didn't) instead of trusting the enqueue result.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) =>
			jsonResponse(await clientProvider().webhooks.deliveries(id)),
	);
	defineTool<{ id: string }>(
		server,
		"subscriptions_dead", // deprecated alias
		"Deprecated alias of webhooks_dead. Removed next minor. List a webhook's dead-letter queue — deliveries that exhausted their retries, with the outbox id, payload, and last error. Diagnose the receiver first (webhooks_get for the URL/auth, webhooks_test for a live probe), then requeue rows with webhooks_requeue.",
		{ id: z.string().describe("Webhook id") },
		async ({ id }) => jsonResponse(await clientProvider().webhooks.dead(id)),
	);
	defineTool<{ id: string; outboxId: string }>(
		server,
		"subscriptions_requeue", // deprecated alias
		"Deprecated alias of webhooks_requeue. Removed next minor. Requeue ONE dead-lettered delivery for another attempt, by its outbox id from webhooks_dead. Fix the receiver first — a requeue against a still-broken endpoint just dies again. Verify with webhooks_deliveries.",
		{
			id: z.string().describe("Webhook id"),
			outboxId: z
				.string()
				.describe("Outbox id of the dead delivery (from webhooks_dead)"),
		},
		async ({ id, outboxId }) =>
			jsonResponse(await clientProvider().webhooks.requeue(id, outboxId)),
	);
	defineTool<{
		id: string;
		fromBlock: number;
		toBlock: number;
		force?: string;
	}>(
		server,
		"subscriptions_replay", // deprecated alias
		"Deprecated alias of webhooks_replay. Removed next minor. Replay a block range for a webhook. Replays run at 10% of batch capacity — use sparingly. Pass `force` (a short idempotency suffix) to re-run a range that was already replayed.",
		{
			id: z.string(),
			fromBlock: z.number().int().nonnegative(),
			toBlock: z.number().int().nonnegative(),
			force: z
				.string()
				.optional()
				.describe(
					"Idempotency suffix to force a duplicate replay of the range",
				),
		},
		async ({ id, fromBlock, toBlock, force }) => {
			const res = await clientProvider().webhooks.replay(id, {
				fromBlock,
				toBlock,
				...(force !== undefined ? { force } : {}),
			});
			return jsonResponse(res);
		},
	);
}
