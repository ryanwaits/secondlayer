import { describe, expect, test } from "bun:test";
import { inferRepairMode, inferRepairModeFromHandlers } from "./repair-mode.ts";

describe("repair mode inference", () => {
	test("append-only set/insert is range_safe", () => {
		expect(
			inferRepairMode(`defineSubgraph({
        handlers: { x: async (e, ctx) => { ctx.set("t", { id: e.tx_id }); } }
      })`).mode,
		).toBe("range_safe");
	});

	test("chain reads default full_reindex", () => {
		const r = inferRepairMode("const v = await ctx.client.readOnly().call()");
		expect(r.mode).toBe("full_reindex");
		expect(r.reasons).toContain("chain read");
	});

	test("accumulators default full_reindex", () => {
		expect(
			inferRepairMode("ctx.increment('bals', { id }, { amt: 1n })").mode,
		).toBe("full_reindex");
	});

	test("unknown operations default full_reindex", () => {
		expect(inferRepairMode("eval(userCode)").mode).toBe("full_reindex");
		expect(inferRepairMode("const x = 1").mode).toBe("full_reindex");
	});

	test("handler matrix: one unsafe handler poisons the subgraph", () => {
		const r = inferRepairModeFromHandlers({
			safe: "ctx.set('t', { id: 1 })",
			bad: "await ctx.client.contract(id).read()",
		});
		expect(r.mode).toBe("full_reindex");
		expect(r.reasons.some((x) => x.startsWith("bad:"))).toBe(true);
	});
});
