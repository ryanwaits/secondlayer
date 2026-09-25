import { afterEach, describe, expect, it } from "bun:test";
import {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
	ChainTriggerSchema,
	CreateWebhookRequestSchema,
	ReplayWebhookRequestSchema,
	UpdateWebhookRequestSchema,
	WebhookFilterSchema,
	validateWebhookFilterForTable,
	webhookMaxRetriesCeiling,
	webhookTimeoutMsCeiling,
} from "./webhooks.ts";

describe("CHAIN_TRIGGER_FIELDS", () => {
	it("covers every chain trigger type", () => {
		expect(Object.keys(CHAIN_TRIGGER_FIELDS).sort()).toEqual(
			[...CHAIN_TRIGGER_TYPES].sort(),
		);
	});

	it("matches the validator's per-type fields (never drifts, excludes `type`)", () => {
		// biome-ignore lint/suspicious/noExplicitAny: zod-internal introspection mirrors the derivation
		for (const opt of (ChainTriggerSchema as any)._zod.def.options) {
			const shape = opt._zod.def.shape as Record<string, unknown>;
			// biome-ignore lint/suspicious/noExplicitAny: literal value on the zod-internal def
			const type = (shape.type as any)._zod.def.values[0] as string;
			const expected = Object.keys(shape).filter((k) => k !== "type");
			expect(CHAIN_TRIGGER_FIELDS[type]).toEqual(expected);
		}
	});

	it("locks known shapes", () => {
		expect(CHAIN_TRIGGER_FIELDS.stx_transfer).toEqual([
			"sender",
			"recipient",
			"minAmount",
			"maxAmount",
		]);
		expect(CHAIN_TRIGGER_FIELDS.contract_call).toEqual([
			"contractId",
			"functionName",
			"caller",
			"trait",
		]);
	});
});

const tables = {
	transfers: {
		columns: {
			sender: { type: "principal" },
			recipient: { type: "principal" },
			amount: { type: "uint" },
			memo: { type: "text" },
			confirmed: { type: "boolean" },
			metadata: { type: "jsonb" },
		},
	},
} as const;

describe("webhook schemas", () => {
	it("accepts supported formats, runtimes, and filters on create", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "large-transfers",
			subgraphName: "stx-transfers",
			tableName: "transfers",
			url: "https://example.com/webhook",
			format: "standard-webhooks",
			runtime: "node",
			filter: {
				amount: { gte: "1000000" },
				sender: { in: ["SP1", "SP2"] },
			},
			maxRetries: 5,
			timeoutMs: 10_000,
			concurrency: 2,
		});

		expect(parsed.format).toBe("standard-webhooks");
		expect(parsed.runtime).toBe("node");
	});

	it("defaults create format to standard-webhooks", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "default-format",
			subgraphName: "stx-transfers",
			tableName: "transfers",
			url: "http://localhost:3000/webhook",
		});

		expect(parsed.format).toBe("standard-webhooks");
	});

	it("rejects invalid create/update/replay payloads", () => {
		expect(() =>
			CreateWebhookRequestSchema.parse({
				name: "bad",
				subgraphName: "sg",
				tableName: "transfers",
				url: "ftp://example.com/webhook",
				format: "xml",
			}),
		).toThrow();

		expect(() => UpdateWebhookRequestSchema.parse({})).toThrow();

		expect(() =>
			ReplayWebhookRequestSchema.parse({
				fromBlock: 20,
				toBlock: 10,
			}),
		).toThrow();
	});

	it("rejects unsupported filter objects", () => {
		expect(
			WebhookFilterSchema.safeParse({ amount: { between: [1, 2] } }),
		).toMatchObject({ success: false });
		expect(
			WebhookFilterSchema.safeParse({ amount: { gt: 1, lt: 2 } }),
		).toMatchObject({ success: false });
		expect(WebhookFilterSchema.safeParse({ amount: [1, 2] })).toMatchObject({
			success: false,
		});
	});

	it("validates filters against subgraph table columns", () => {
		expect(
			validateWebhookFilterForTable({
				subgraphName: "stx-transfers",
				tableName: "transfers",
				filter: { amount: { gte: "1000" }, sender: "SP1" },
				tables,
			}),
		).toEqual([]);

		expect(
			validateWebhookFilterForTable({
				tableName: "missing",
				filter: {},
				tables,
			})[0],
		).toContain('Unknown table "missing"');

		expect(
			validateWebhookFilterForTable({
				tableName: "transfers",
				filter: { unknown: "x" },
				tables,
			})[0],
		).toBe('Unknown filter field "unknown" on table "transfers".');

		expect(
			validateWebhookFilterForTable({
				tableName: "transfers",
				filter: { memo: { gt: "abc" } },
				tables,
			})[0],
		).toBe('Operator "gt" is not supported for text field "memo".');

		expect(
			validateWebhookFilterForTable({
				tableName: "transfers",
				filter: { metadata: "x" },
				tables,
			})[0],
		).toBe(
			'Filter field "metadata" has unsupported type "jsonb"; webhook filters require scalar columns.',
		);
	});
});

describe("chain webhooks (direct chain triggers)", () => {
	it("accepts a chain webhook with triggers and no subgraph target", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "swaps",
			url: "https://example.com/webhook",
			triggers: [
				{
					type: "contract_call",
					contractId: "SP123.amm",
					functionName: "swap-*",
				},
				{ type: "ft_transfer", trait: "sip-010", minAmount: "1000000" },
			],
		});
		expect(parsed.triggers).toHaveLength(2);
		expect(parsed.subgraphName).toBeUndefined();
		expect(parsed.format).toBe("standard-webhooks");
	});

	it("accepts amounts as both string and number", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "x",
			url: "https://x.com/h",
			triggers: [
				{
					type: "stx_transfer",
					minAmount: "340282366920938463463374607431768211455",
				},
				{ type: "stx_burn", minAmount: 100 },
			],
		});
		expect(parsed.triggers).toHaveLength(2);
	});

	it("rejects mixing subgraph target and triggers", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			subgraphName: "sg",
			tableName: "t",
			triggers: [{ type: "contract_call" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects neither mode (no subgraph target, no triggers)", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
		});
		expect(r.success).toBe(false);
	});

	it("rejects subgraph mode missing tableName", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			subgraphName: "sg",
		});
		expect(r.success).toBe(false);
	});

	it("rejects an unknown field on a trigger (strict)", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call", bogus: 1 }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects an empty triggers array", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [],
		});
		expect(r.success).toBe(false);
	});

	it("rejects an unknown trigger type", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "not_a_real_event" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects a non-integer amount string", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "stx_transfer", minAmount: "12.5" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects combining filter with triggers", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			filter: { amount: { gte: "1" } },
		});
		expect(r.success).toBe(false);
	});
});

describe("delivery cap ceilings", () => {
	afterEach(() => {
		Reflect.deleteProperty(process.env, "WEBHOOK_MAX_RETRIES_CEILING");
		Reflect.deleteProperty(process.env, "WEBHOOK_TIMEOUT_MS_CEILING");
	});

	it("defaults to the self-host ceilings unchanged (100 retries, 300s)", () => {
		expect(webhookMaxRetriesCeiling()).toBe(100);
		expect(webhookTimeoutMsCeiling()).toBe(300_000);
	});

	it("accepts maxRetries/timeoutMs at the default ceiling", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			maxRetries: 100,
			timeoutMs: 300_000,
		});
		expect(r.success).toBe(true);
	});

	it("rejects maxRetries above the default ceiling with the ceiling in the message", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			maxRetries: 101,
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe(
				"maxRetries exceeds ceiling (100)",
			);
		}
	});

	it("rejects timeoutMs above the default ceiling with the ceiling in the message", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			timeoutMs: 300_001,
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe(
				"timeoutMs exceeds ceiling (300000)",
			);
		}
	});

	it("respects a lower WEBHOOK_MAX_RETRIES_CEILING env override", () => {
		process.env.WEBHOOK_MAX_RETRIES_CEILING = "7";
		expect(webhookMaxRetriesCeiling()).toBe(7);
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			maxRetries: 8,
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe("maxRetries exceeds ceiling (7)");
		}
	});

	it("respects a lower WEBHOOK_TIMEOUT_MS_CEILING env override", () => {
		process.env.WEBHOOK_TIMEOUT_MS_CEILING = "30000";
		expect(webhookTimeoutMsCeiling()).toBe(30_000);
		const r = UpdateWebhookRequestSchema.safeParse({ timeoutMs: 30_001 });
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe(
				"timeoutMs exceeds ceiling (30000)",
			);
		}
	});

	it("ignores a non-numeric env override and falls back to the default", () => {
		process.env.WEBHOOK_MAX_RETRIES_CEILING = "not-a-number";
		expect(webhookMaxRetriesCeiling()).toBe(100);
	});
});
