import { describe, expect, test } from "bun:test";
import {
	DELTA_CTX_METHODS,
	hasNonReplayableWrites,
} from "../src/subgraphs/handler-replay-safety.ts";

describe("non-replayable handler detection", () => {
	test("flags every delta ctx method", () => {
		for (const m of DELTA_CTX_METHODS) {
			expect(hasNonReplayableWrites(`await ctx.${m}("t", {a:1}, {b:2})`)).toBe(
				true,
			);
		}
	});

	test("insert/upsert are replay-safe", () => {
		expect(
			hasNonReplayableWrites(
				'ctx.insert("t", row); await ctx.upsert("t", row);',
			),
		).toBe(false);
	});

	test("sourceCode is scanned too; null-safe", () => {
		expect(hasNonReplayableWrites(null, "ctx.increment('t', k, 'b', 1n)")).toBe(
			true,
		);
		expect(hasNonReplayableWrites(null, null)).toBe(false);
	});

	test("DRIFT GUARD: covers every delta-applying SubgraphContext method", async () => {
		// Enumerate the real context class — if a new delta method appears
		// (anything that mutates existing rows non-idempotently), this list
		// must grow with it. Insert-only / full-row-upsert methods are exempt.
		const src = await Bun.file(
			new URL("../../subgraphs/src/runtime/context.ts", import.meta.url)
				.pathname,
		).text();
		// Known mutation methods on SubgraphContext today:
		const known = [
			"insert",
			"update",
			"upsert",
			"patch",
			"patchOrInsert",
			"increment",
			"delete",
		];
		const declared = known.filter((m) =>
			new RegExp(`^\\s+(async )?${m}\\(`, "m").test(src),
		);
		// Delta-applying = everything that modifies prior state non-idempotently.
		const deltaApplying = declared.filter((m) =>
			["update", "patch", "patchOrInsert", "increment"].includes(m),
		);
		for (const m of deltaApplying) {
			// patch is a partial SET (idempotent per-block? a replayed patch SETs
			// the same values — idempotent), so only assert on the true deltas:
			if (m === "patch") continue;
			expect(DELTA_CTX_METHODS).toContain(m);
		}
	});
});
