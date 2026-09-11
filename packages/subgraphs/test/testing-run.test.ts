import { describe, expect, test } from "bun:test";
import { defineSubgraph } from "../src/define.ts";
import { runSubgraphTest, toHandlerPayload } from "../src/testing/index.ts";

const printSource = {
	type: "print_event" as const,
	contractId: "SP.dex",
	prints: { swap: { tokenX: "text" as const } },
};

const swaps = defineSubgraph({
	name: "dex-swaps",
	sources: { prints: printSource },
	schema: {
		swaps: {
			columns: { token_x: { type: "text" } },
		},
	},
	handlers: {
		prints: (event, ctx) => {
			const tokenX = (event.data as { tokenX?: string }).tokenX;
			if (tokenX == null) return;
			ctx.insert("swaps", { token_x: tokenX });
		},
	},
});

const broken = defineSubgraph({
	...swaps,
	handlers: {
		prints: (event, ctx) => {
			// Wrong field — amountIn is not on the print payload.
			const amountIn = (event.data as { amountIn?: string }).amountIn;
			if (amountIn == null) return;
			ctx.insert("swaps", { token_x: amountIn });
		},
	},
});

function printRow(value: unknown) {
	return {
		cursor: "c1",
		event_type: "print",
		contract_id: "SP.dex",
		payload: { topic: "swap", value },
	};
}

describe("runSubgraphTest", () => {
	test("matched events that write rows are ok", async () => {
		const result = await runSubgraphTest({
			schema: swaps.schema,
			handlers: swaps.handlers as Record<string, unknown>,
			sources: swaps.sources as Record<string, { type: string }>,
			events: {
				prints: [printRow({ "token-x": "SP.token" })],
			},
		});
		expect(result.ok).toBe(true);
		expect(result.matched).toBe(1);
		expect(result.written).toBe(1);
		expect(result.tables[0]).toMatchObject({ name: "swaps", rows: 1 });
		expect(result.tables[0]?.sampleRow?.token_x).toBe("SP.token");
	});

	test("matched events with 0 rows are EMPTY_MAPPING and name observed keys", async () => {
		const result = await runSubgraphTest({
			schema: broken.schema,
			handlers: broken.handlers as Record<string, unknown>,
			sources: broken.sources as Record<string, { type: string }>,
			events: {
				prints: [printRow({ "token-x": "SP.token" })],
			},
		});
		expect(result.ok).toBe(false);
		expect(result.code).toBe("EMPTY_MAPPING");
		expect(result.matched).toBe(1);
		expect(result.written).toBe(0);
		expect(result.hint).toContain("tokenX");
		expect(result.hint).toContain("do not invent fields");
		expect(result.firstEvent?.data).toEqual({ tokenX: "SP.token" });
	});

	test("zero fetched events are NO_EVENTS", async () => {
		const result = await runSubgraphTest({
			schema: swaps.schema,
			handlers: swaps.handlers as Record<string, unknown>,
			sources: swaps.sources as Record<string, { type: string }>,
			events: { prints: [] },
		});
		expect(result.ok).toBe(false);
		expect(result.code).toBe("NO_EVENTS");
		expect(result.matched).toBe(0);
	});

	test("empty sources are NO_SOURCES", async () => {
		const result = await runSubgraphTest({
			schema: swaps.schema,
			handlers: {},
			sources: {},
			events: {},
		});
		expect(result.ok).toBe(false);
		expect(result.code).toBe("NO_SOURCES");
	});

	test("trace: true emits per-event IN/OUT and fails on a zero-OUT event", async () => {
		const result = await runSubgraphTest({
			schema: swaps.schema,
			handlers: swaps.handlers as Record<string, unknown>,
			sources: swaps.sources as Record<string, { type: string }>,
			events: {
				prints: [
					printRow({ "token-x": "SP.token" }),
					printRow({ "amount-in": "1" }),
				],
			},
			trace: true,
		});
		expect(result.ok).toBe(false);
		expect(result.code).toBe("EMPTY_MAPPING");
		expect(result.traces).toHaveLength(2);
		expect(result.traces?.[0]?.outs[0]).toMatchObject({
			table: "swaps",
			keys: expect.arrayContaining(["token_x"]),
		});
		expect(result.traces?.[1]?.outs).toEqual([]);
		expect(result.traces?.[1]?.inKeys).toContain("amountIn");
	});
});

describe("toHandlerPayload print camelization", () => {
	test("kebab print keys become camelCase", () => {
		const payload = toHandlerPayload(
			{ type: "print_event" },
			printRow({ "bitcoin-txid": "0xab", "output-index": 1 }),
		);
		expect(payload.data).toEqual({ bitcoinTxid: "0xab", outputIndex: 1 });
	});
});
