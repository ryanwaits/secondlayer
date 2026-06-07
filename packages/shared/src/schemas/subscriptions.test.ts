import { describe, expect, it } from "bun:test";
import {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
	ChainTriggerSchema,
	CreateSubscriptionRequestSchema,
	ReplaySubscriptionRequestSchema,
	SubscriptionFilterSchema,
	UpdateSubscriptionRequestSchema,
	validateSubscriptionFilterForTable,
} from "./subscriptions.ts";

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

describe("subscription schemas", () => {
	it("accepts supported formats, runtimes, and filters on create", () => {
		const parsed = CreateSubscriptionRequestSchema.parse({
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
		const parsed = CreateSubscriptionRequestSchema.parse({
			name: "default-format",
			subgraphName: "stx-transfers",
			tableName: "transfers",
			url: "http://localhost:3000/webhook",
		});

		expect(parsed.format).toBe("standard-webhooks");
	});

	it("rejects invalid create/update/replay payloads", () => {
		expect(() =>
			CreateSubscriptionRequestSchema.parse({
				name: "bad",
				subgraphName: "sg",
				tableName: "transfers",
				url: "ftp://example.com/webhook",
				format: "xml",
			}),
		).toThrow();

		expect(() => UpdateSubscriptionRequestSchema.parse({})).toThrow();

		expect(() =>
			ReplaySubscriptionRequestSchema.parse({
				fromBlock: 20,
				toBlock: 10,
			}),
		).toThrow();
	});

	it("rejects unsupported filter objects", () => {
		expect(
			SubscriptionFilterSchema.safeParse({ amount: { between: [1, 2] } }),
		).toMatchObject({ success: false });
		expect(
			SubscriptionFilterSchema.safeParse({ amount: { gt: 1, lt: 2 } }),
		).toMatchObject({ success: false });
		expect(
			SubscriptionFilterSchema.safeParse({ amount: [1, 2] }),
		).toMatchObject({ success: false });
	});

	it("validates filters against subgraph table columns", () => {
		expect(
			validateSubscriptionFilterForTable({
				subgraphName: "stx-transfers",
				tableName: "transfers",
				filter: { amount: { gte: "1000" }, sender: "SP1" },
				tables,
			}),
		).toEqual([]);

		expect(
			validateSubscriptionFilterForTable({
				tableName: "missing",
				filter: {},
				tables,
			})[0],
		).toContain('Unknown table "missing"');

		expect(
			validateSubscriptionFilterForTable({
				tableName: "transfers",
				filter: { unknown: "x" },
				tables,
			})[0],
		).toBe('Unknown filter field "unknown" on table "transfers".');

		expect(
			validateSubscriptionFilterForTable({
				tableName: "transfers",
				filter: { memo: { gt: "abc" } },
				tables,
			})[0],
		).toBe('Operator "gt" is not supported for text field "memo".');

		expect(
			validateSubscriptionFilterForTable({
				tableName: "transfers",
				filter: { metadata: "x" },
				tables,
			})[0],
		).toBe(
			'Filter field "metadata" has unsupported type "jsonb"; subscription filters require scalar columns.',
		);
	});
});

describe("chain subscriptions (direct chain triggers)", () => {
	it("accepts a chain subscription with triggers and no subgraph target", () => {
		const parsed = CreateSubscriptionRequestSchema.parse({
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
		const parsed = CreateSubscriptionRequestSchema.parse({
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
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			subgraphName: "sg",
			tableName: "t",
			triggers: [{ type: "contract_call" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects neither mode (no subgraph target, no triggers)", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
		});
		expect(r.success).toBe(false);
	});

	it("rejects subgraph mode missing tableName", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			subgraphName: "sg",
		});
		expect(r.success).toBe(false);
	});

	it("rejects an unknown field on a trigger (strict)", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call", bogus: 1 }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects an empty triggers array", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [],
		});
		expect(r.success).toBe(false);
	});

	it("rejects an unknown trigger type", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "not_a_real_event" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects a non-integer amount string", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "stx_transfer", minAmount: "12.5" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects combining filter with triggers", () => {
		const r = CreateSubscriptionRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			filter: { amount: { gte: "1" } },
		});
		expect(r.success).toBe(false);
	});
});
