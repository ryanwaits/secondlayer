import { describe, expect, test } from "bun:test";
import {
	type EventTrace,
	type SubgraphTestResult,
	runSubgraphTest,
} from "@secondlayer/subgraphs/testing";
import { formatEventTrace, formatPreviewReport } from "./subgraph-preview.ts";

describe("formatEventTrace", () => {
	test("renders IN keys and OUT table columns", () => {
		const t: EventTrace = {
			source: "swap",
			blockHeight: 18429112,
			txId: "0xabc",
			inKeys: ["tokenX", "tokenY", "dx", "dy"],
			outs: [{ table: "swaps", keys: ["token_x", "amount_x"] }],
		};
		expect(formatEventTrace(t)).toEqual([
			"block 18429112  tx 0xabc  source=swap",
			"  IN   { tokenX, tokenY, dx, dy }",
			"  OUT  swaps ← { token_x, amount_x }",
		]);
	});

	test("empty OUT is explicit", () => {
		const t: EventTrace = {
			source: "swap",
			blockHeight: 1,
			txId: "0x1",
			inKeys: ["tokenX"],
			outs: [],
		};
		expect(formatEventTrace(t)).toContain("  OUT  (no insert)");
	});
});

describe("preview empty-OUT exit path", () => {
	test("one good OUT and one empty OUT is EMPTY_MAPPING with empty event keys", async () => {
		const result = await runSubgraphTest({
			schema: {
				swaps: { columns: { token_x: { type: "text" } } },
			},
			handlers: {
				prints: (
					event: { data?: { tokenX?: string } },
					ctx: {
						insert: (t: string, r: Record<string, unknown>) => void;
					},
				) => {
					const tokenX = event.data?.tokenX;
					if (tokenX == null) return;
					ctx.insert("swaps", { token_x: tokenX });
				},
			},
			sources: { prints: { type: "print_event", contractId: "SP.dex" } },
			events: {
				prints: [
					{
						cursor: "c1",
						block_height: 10,
						tx_id: "0xgood",
						event_type: "print",
						contract_id: "SP.dex",
						payload: { topic: "swap", value: { "token-x": "SP.a" } },
					},
					{
						cursor: "c2",
						block_height: 11,
						tx_id: "0xempty",
						event_type: "print",
						contract_id: "SP.dex",
						payload: {
							topic: "swap",
							value: { "amount-in": "1" },
						},
					},
				],
			},
			trace: true,
		});

		expect(result.ok).toBe(false);
		expect(result.code).toBe("EMPTY_MAPPING");
		expect(result.traces?.some((t) => t.outs.length === 0)).toBe(true);
		const empty = result.traces?.find((t) => t.outs.length === 0);
		expect(empty?.inKeys).toContain("amountIn");
		expect(empty?.txId).toBe("0xempty");

		const report = formatPreviewReport(result as SubgraphTestResult);
		expect(report.some((l) => l.includes("OUT  (no insert)"))).toBe(true);
		expect(report.some((l) => l.includes("amountIn"))).toBe(true);
	});

	test("unused IN fields that never appear in OUT are flagged", async () => {
		const result = await runSubgraphTest({
			schema: {
				swaps: { columns: { token_x: { type: "text" } } },
			},
			handlers: {
				prints: (
					event: { data?: { tokenX?: string; ignored?: string } },
					ctx: { insert: (t: string, r: Record<string, unknown>) => void },
				) => {
					ctx.insert("swaps", { token_x: event.data?.tokenX ?? "" });
				},
			},
			sources: { prints: { type: "print_event" } },
			events: {
				prints: [
					{
						cursor: "c1",
						block_height: 1,
						tx_id: "0x1",
						event_type: "print",
						payload: {
							topic: "swap",
							value: { "token-x": "SP.a", ignored: "x" },
						},
					},
					{
						cursor: "c2",
						block_height: 2,
						tx_id: "0x2",
						event_type: "print",
						payload: {
							topic: "swap",
							value: { "token-x": "SP.b", ignored: "y" },
						},
					},
				],
			},
			trace: true,
		});
		expect(result.ok).toBe(true);
		expect(result.unusedInKeys).toContain("ignored");
		const report = formatPreviewReport(result);
		expect(
			report.some(
				(l) => l.includes("never in any OUT") && l.includes("ignored"),
			),
		).toBe(true);
	});
});
