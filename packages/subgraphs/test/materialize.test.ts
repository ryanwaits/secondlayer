import { describe, expect, test } from "bun:test";
import { defineSubgraph } from "../src/define.ts";
import { applyMaterializeInsert } from "../src/runtime/materialize.ts";
import {
	buildEvent,
	createTestContext,
	probeHandlers,
} from "../src/testing/index.ts";
import { validateSubgraphDefinition } from "../src/validate.ts";

const swaps = defineSubgraph({
	name: "swaps",
	sources: {
		swap: {
			type: "print_event",
			contractId: "SP1.pool",
			prints: {
				swap: {
					tokenX: "principal",
					dx: "uint",
					note: { type: "text", optional: true },
				},
			},
			materialize: {
				table: "swaps",
				columns: {
					token_x: { from: "tokenX" },
					amount_x: { from: "dx" },
					note: { from: "note" },
					topic: { from: "topic" },
					sender: { fromTx: "sender" },
				},
			},
		},
	},
	schema: {
		swaps: {
			columns: {
				token_x: { type: "principal" },
				amount_x: { type: "uint" },
				note: { type: "text", nullable: true },
				topic: { type: "text" },
				sender: { type: "principal" },
			},
		},
	},
	handlers: {},
});

const swapMaterialize = swaps.sources.swap.materialize;
if (!swapMaterialize) throw new Error("expected materialize on swap source");

describe("materialize identity maps", () => {
	test("inserts a row from print fields + fromTx", () => {
		const ctx = createTestContext(swaps.schema, {
			tx: { sender: "SPSENDER" },
		});
		const event = buildEvent(swaps.sources.swap, {
			topic: "swap",
			data: { tokenX: "SPTOKEN", dx: 42n },
		});
		const result = applyMaterializeInsert(
			swapMaterialize,
			event as Record<string, unknown>,
			ctx,
			swaps.schema,
		);
		expect(result.ok).toBe(true);
		return ctx.rows("swaps").then((rows) => {
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				token_x: "SPTOKEN",
				amount_x: 42n,
				note: null,
				topic: "swap",
				sender: "SPSENDER",
			});
		});
	});

	test("nullable missing field becomes null", async () => {
		const ctx = createTestContext(swaps.schema);
		const event = buildEvent(swaps.sources.swap, {
			topic: "swap",
			data: { tokenX: "SPTOKEN", dx: 1n },
		});
		applyMaterializeInsert(
			swapMaterialize,
			event as Record<string, unknown>,
			ctx,
			swaps.schema,
		);
		const rows = await ctx.rows("swaps");
		expect(rows[0]?.note).toBeNull();
	});

	test("required missing field skips without insert", async () => {
		const ctx = createTestContext(swaps.schema);
		const event = buildEvent(swaps.sources.swap, {
			topic: "swap",
			data: { tokenX: "SPTOKEN" },
		});
		const result = applyMaterializeInsert(
			swapMaterialize,
			event as Record<string, unknown>,
			ctx,
			swaps.schema,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/dx/);
		expect(await ctx.rows("swaps")).toHaveLength(0);
	});

	test("wrong from never reaches runtime — validate catches it", () => {
		expect(() =>
			validateSubgraphDefinition({
				...swaps,
				sources: {
					swap: {
						...swaps.sources.swap,
						materialize: {
							table: "swaps",
							columns: { amount_x: { from: "notAField" } },
						},
					},
				},
			}),
		).toThrow(/known:/);
	});

	test("probeHandlers on materialize-only def writes rows", async () => {
		const result = await probeHandlers(
			{
				schema: swaps.schema,
				sources: swaps.sources as Record<
					string,
					{ type: string; [k: string]: unknown }
				>,
				handlers: {},
			},
			[
				{
					source: "swap",
					event: {
						topic: "swap",
						data: { tokenX: "SPTOKEN", dx: 7n },
					},
				},
			],
		);
		expect(result.matched).toBe(1);
		expect(result.written).toBeGreaterThanOrEqual(1);
	});
});
