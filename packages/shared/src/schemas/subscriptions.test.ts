import { describe, expect, it } from "bun:test";
import {
	CreateSubscriptionRequestSchema,
	ReplaySubscriptionRequestSchema,
	SubscriptionFilterSchema,
	UpdateSubscriptionRequestSchema,
	validateSubscriptionFilterForTable,
} from "./subscriptions.ts";

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
