import { afterEach, describe, expect, test } from "bun:test";
import { runHandlers } from "../src/runtime/runner.ts";
import type { MatchedTx } from "../src/runtime/source-matcher.ts";
import {
	type PrintViolationInput,
	setPrintViolationRecorder,
} from "../src/runtime/violations.ts";
import type { SubgraphDefinition, SubgraphFilter } from "../src/types.ts";

function mockCtx(height = 100) {
	const calls: { method: string; args: unknown[] }[] = [];
	return {
		calls,
		block: { height, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
		tx: { txId: "", sender: "", type: "", status: "" },
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		setTx(tx: any) {
			this.tx = tx;
		},
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		insert(table: string, row: any) {
			calls.push({ method: "insert", args: [table, row] });
		},
		pendingOps: 0,
		opsCheckpoint() {
			return calls.length;
		},
		rollbackTo(checkpoint: number) {
			calls.length = checkpoint;
		},
		async flush() {
			return 0;
		},
	};
}

afterEach(() => {
	setPrintViolationRecorder(null);
});

describe("print-validate violations", () => {
	test("mismatched print records one violation; matching print records none", async () => {
		const recorded: PrintViolationInput[] = [];
		setPrintViolationRecorder(async (input) => {
			recorded.push(input);
		});

		const sources: Record<string, SubgraphFilter> = {
			prints: {
				type: "print_event",
				contractId: "SP.dex",
				prints: {
					swap: { tokenX: "text", amount: "uint" },
				},
			},
		};

		const sg: SubgraphDefinition = {
			name: "dex",
			// biome-ignore lint/suspicious/noExplicitAny: test fixture
			sources: sources as any,
			schema: { swaps: { columns: { token_x: { type: "text" } } } },
			handlers: {
				prints: () => {},
			},
		};

		const bad: MatchedTx = {
			tx: {
				tx_id: "0xbad",
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP.dex",
				function_name: "swap",
			},
			events: [
				{
					id: "e1",
					tx_id: "0xbad",
					type: "contract_event",
					event_index: 0,
					data: {
						topic: "swap",
						// Missing required `amount`; tokenX present as kebab.
						value: { "token-x": "SP.a" },
						contract_identifier: "SP.dex",
					},
				},
			],
			sourceName: "prints",
		};

		const good: MatchedTx = {
			tx: {
				tx_id: "0xgood",
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP.dex",
				function_name: "swap",
			},
			events: [
				{
					id: "e2",
					tx_id: "0xgood",
					type: "contract_event",
					event_index: 0,
					data: {
						topic: "swap",
						value: { "token-x": "SP.a", amount: 1n },
						contract_identifier: "SP.dex",
					},
				},
			],
			sourceName: "prints",
		};

		const ctx = mockCtx(42);
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const badResult = await runHandlers(sg, [bad], ctx as any);
		expect(badResult.skipped).toBe(1);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			subgraphName: "dex",
			sourceName: "prints",
			blockHeight: 42,
			txId: "0xbad",
		});
		expect(recorded[0]?.reason).toContain("amount");

		recorded.length = 0;
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const goodResult = await runHandlers(sg, [good], ctx as any);
		expect(goodResult.skipped ?? 0).toBe(0);
		expect(goodResult.processed).toBe(1);
		expect(recorded).toHaveLength(0);
	});
});
