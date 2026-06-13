import { describe, expect, test } from "bun:test";
import { diffSchema, hasBreakingChanges } from "./schema/deployer.ts";
import { validateSubgraphDefinition } from "./validate.ts";

const BASE = {
	name: "tipfirst-test",
	sources: { t: { type: "ft_transfer", assetIdentifier: "SP1.tok::t" } },
	schema: {
		balances: {
			columns: {
				address: { type: "principal" },
				balance: { type: "uint" },
			},
			uniqueKeys: [["address"]],
		},
	},
	handlers: { t: () => {} },
};

describe("tip-first deploy plumbing", () => {
	test("backfillMode validates: blocking/concurrent ok, junk rejected", () => {
		expect(
			validateSubgraphDefinition({ ...BASE, backfillMode: "concurrent" })
				.backfillMode,
		).toBe("concurrent");
		expect(
			validateSubgraphDefinition({ ...BASE, backfillMode: "blocking" })
				.backfillMode,
		).toBe("blocking");
		expect(() =>
			validateSubgraphDefinition({ ...BASE, backfillMode: "yolo" }),
		).toThrow();
		expect(validateSubgraphDefinition(BASE).backfillMode).toBeUndefined();
	});

	test("breaking detection: removed/changed columns flag, additive does not", () => {
		const oldSchema = BASE.schema;
		const additive = {
			balances: {
				columns: {
					address: { type: "principal" },
					balance: { type: "uint" },
					updated_at: { type: "uint" },
				},
				uniqueKeys: [["address"]],
			},
		};
		const breaking = {
			balances: {
				columns: { address: { type: "principal" } },
				uniqueKeys: [["address"]],
			},
		};
		// biome-ignore lint/suspicious/noExplicitAny: schema shapes for diff
		const diff1 = diffSchema(oldSchema as any, additive as any);
		expect(hasBreakingChanges(diff1).breaking).toBe(false);
		// biome-ignore lint/suspicious/noExplicitAny: schema shapes for diff
		const diff2 = diffSchema(oldSchema as any, breaking as any);
		const verdict = hasBreakingChanges(diff2);
		expect(verdict.breaking).toBe(true);
		expect(verdict.reasons.join(" ")).toContain("balance");
	});
});
