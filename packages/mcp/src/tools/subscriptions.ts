import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
	ChainTrigger,
	CreateSubscriptionRequest,
	UpdateSubscriptionRequest,
} from "@secondlayer/sdk";
import { CHAIN_TRIGGER_TYPES } from "@secondlayer/shared";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type SubscriptionClientProvider = typeof getClient;

/**
 * Subscription MCP tools — let agents list, configure, test, and replay
 * subgraph event subscriptions. Mirrors the HTTP API 1:1; structured
 * errors bubble through the SDK's ApiError.
 */
export function registerSubscriptionTools(
	server: McpServer,
	clientProvider: SubscriptionClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"subscriptions_list",
		"List all subscriptions for the current account. Returns summary fields (no secrets).",
		{},
		async () => {
			const { data } = await clientProvider().subscriptions.list();
			return jsonResponse(data);
		},
	);

	defineTool<{ id: string }>(
		server,
		"subscriptions_get",
		"Get full detail for a subscription (filter, auth, retry config, circuit state).",
		{ id: z.string().describe("Subscription id") },
		async ({ id }) => {
			const detail = await clientProvider().subscriptions.get(id);
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
		"subscriptions_create",
		"Create a subscription. Two kinds (mutually exclusive): a SUBGRAPH subscription fires on a subgraph table's rows (set subgraphName + tableName + optional filter); a CHAIN subscription fires on raw chain events with no subgraph (set triggers). Returns `signingSecret` ONCE — forward it to the user so they can wire it into their receiver.",
		{
			name: z.string().describe("Human-readable name, unique per account"),
			subgraphName: z
				.string()
				.optional()
				.describe("Subgraph to subscribe to (subgraph subscription)"),
			tableName: z
				.string()
				.optional()
				.describe("Table within the subgraph (subgraph subscription)"),
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
					"Chain triggers (chain subscription) — provide INSTEAD of subgraphName/tableName. Each targets a raw chain event/tx; string fields accept `*` wildcards, `trait` scopes to a SIP/trait. Per-type accepted fields: see the secondlayer://chain-triggers resource. Forward-looking: starts at chain tip, no backfill.",
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
			const res = await clientProvider().subscriptions.create(
				input as CreateSubscriptionRequest,
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
		"subscriptions_update",
		"Patch a subscription (name, url, filter, authConfig, format, runtime, retry, timeout, concurrency).",
		{
			id: z.string(),
			name: z.string().optional().describe("Rename the subscription"),
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
			const res = await clientProvider().subscriptions.update(
				id,
				patch as UpdateSubscriptionRequest,
			);
			return jsonResponse(res);
		},
	);

	defineTool<{ id: string }>(
		server,
		"subscriptions_delete",
		"Delete a subscription. Pending outbox rows are cascade-deleted.",
		{ id: z.string() },
		async ({ id }) => {
			const res = await clientProvider().subscriptions.delete(id);
			return jsonResponse(res);
		},
	);

	defineTool<{ id: string }>(
		server,
		"subscriptions_test",
		"Send a one-off test webhook to a subscription's URL (built for its format, SSRF-guarded). Logged as a delivery row. Returns {ok, statusCode, error, durationMs, deliveryId}.",
		{ id: z.string().describe("Subscription id") },
		async ({ id }) => {
			const res = await clientProvider().subscriptions.test(id);
			return jsonResponse(res);
		},
	);

	defineTool<{
		id: string;
		fromBlock: number;
		toBlock: number;
		force?: string;
	}>(
		server,
		"subscriptions_replay",
		"Replay a block range for a subscription. Replays run at 10% of batch capacity — use sparingly. Pass `force` (a short idempotency suffix) to re-run a range that was already replayed.",
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
			const res = await clientProvider().subscriptions.replay(id, {
				fromBlock,
				toBlock,
				...(force !== undefined ? { force } : {}),
			});
			return jsonResponse(res);
		},
	);
}
