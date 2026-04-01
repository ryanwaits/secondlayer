import { describe, expect, test } from "bun:test";
import { runHandlers } from "../src/runtime/runner.ts";
import type { MatchedTx } from "../src/runtime/source-matcher.ts";
import type { SubgraphDefinition } from "../src/types.ts";

function mockCtx() {
	const calls: { method: string; args: unknown[] }[] = [];
	return {
		calls,
		block: { height: 100, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
		tx: { txId: "", sender: "", type: "", status: "" },
		setTx(tx: any) {
			this.tx = tx;
		},
		insert(table: string, row: any) {
			calls.push({ method: "insert", args: [table, row] });
		},
		update(table: string, where: any, set: any) {
			calls.push({ method: "update", args: [table, where, set] });
		},
		delete(table: string, where: any) {
			calls.push({ method: "delete", args: [table, where] });
		},
		pendingOps: 0,
		async flush() {
			return 0;
		},
	};
}

const matched: MatchedTx[] = [
	{
		tx: {
			tx_id: "tx1",
			type: "contract_call",
			sender: "SP1",
			status: "success",
		},
		events: [
			{ id: "e1", tx_id: "tx1", type: "event", event_index: 0, data: {} },
		],
		sourceKey: "SP::c",
	},
];

describe("subgraph isolation", () => {
	test("slow handler triggers timeout via error threshold", async () => {
		let callCount = 0;
		const sg: SubgraphDefinition = {
			name: "slow-subgraph",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {
				"SP::c": async () => {
					callCount++;
					// Simulate slow handler that exceeds per-event timeout
					await new Promise((_, reject) =>
						setTimeout(() => reject(new Error("timeout")), 10),
					);
				},
			},
		};

		const manyEvents: MatchedTx[] = [
			{
				tx: {
					tx_id: "tx1",
					type: "contract_call",
					sender: "SP1",
					status: "success",
				},
				events: Array.from({ length: 5 }, (_, i) => ({
					id: `e${i}`,
					tx_id: "tx1",
					type: "event",
					event_index: i,
					data: {},
				})),
				sourceKey: "SP::c",
			},
		];

		const ctx = mockCtx();
		const result = await runHandlers(sg, manyEvents, ctx as any, {
			errorThreshold: 3,
		});
		expect(result.errors).toBeGreaterThanOrEqual(1);
		expect(callCount).toBeLessThanOrEqual(3);
	});

	test("one subgraph error does not block other subgraphs", async () => {
		const results: string[] = [];

		const failingSubgraph: SubgraphDefinition = {
			name: "failing-subgraph",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {
				"SP::c": () => {
					throw new Error("subgraph1 exploded");
				},
			},
		};

		const healthySubgraph: SubgraphDefinition = {
			name: "healthy-subgraph",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {
				"SP::c": () => {
					results.push("healthy processed");
				},
			},
		};

		// Simulate Promise.allSettled processing (mirrors processor.ts pattern)
		const outcomes = await Promise.allSettled([
			(async () => {
				const ctx = mockCtx();
				return runHandlers(failingSubgraph, matched, ctx as any);
			})(),
			(async () => {
				const ctx = mockCtx();
				return runHandlers(healthySubgraph, matched, ctx as any);
			})(),
		]);

		// Failing subgraph should have errors but not crash
		const failResult = outcomes[0]!;
		expect(failResult.status).toBe("fulfilled");
		if (failResult.status === "fulfilled") {
			expect(failResult.value.errors).toBe(1);
		}

		// Healthy subgraph should process normally
		const healthyResult = outcomes[1]!;
		expect(healthyResult.status).toBe("fulfilled");
		if (healthyResult.status === "fulfilled") {
			expect(healthyResult.value.processed).toBe(1);
			expect(healthyResult.value.errors).toBe(0);
		}

		expect(results).toEqual(["healthy processed"]);
	});

	test("empty block (0 matched events) does not error", async () => {
		const sg: SubgraphDefinition = {
			name: "empty-block-subgraph",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {
				"SP::c": () => {
					throw new Error("should not be called");
				},
			},
		};

		const ctx = mockCtx();
		const result = await runHandlers(sg, [], ctx as any);
		expect(result.processed).toBe(0);
		expect(result.errors).toBe(0);
	});

	test("overlapping sources: 2 subgraphs match same event, both process independently", async () => {
		const results: string[] = [];

		const subgraph1: SubgraphDefinition = {
			name: "subgraph-a",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {
				"SP::c": () => {
					results.push("subgraph-a");
				},
			},
		};

		const subgraph2: SubgraphDefinition = {
			name: "subgraph-b",
			sources: [{ contract: "SP::c" }],
			schema: { data: { columns: { x: { type: "text" } } } },
			handlers: {
				"SP::c": () => {
					results.push("subgraph-b");
				},
			},
		};

		const outcomes = await Promise.allSettled([
			(async () => {
				const ctx = mockCtx();
				return runHandlers(subgraph1, matched, ctx as any);
			})(),
			(async () => {
				const ctx = mockCtx();
				return runHandlers(subgraph2, matched, ctx as any);
			})(),
		]);

		expect(outcomes[0]!.status).toBe("fulfilled");
		expect(outcomes[1]!.status).toBe("fulfilled");
		expect(results).toContain("subgraph-a");
		expect(results).toContain("subgraph-b");
		expect(results.length).toBe(2);
	});
});
