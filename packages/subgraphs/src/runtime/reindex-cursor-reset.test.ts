import { describe, expect, test } from "bun:test";

/**
 * Guards the invariant behind the sbtc-balances halt-at-1913668 incident:
 * a schema-dropping reindex MUST reset last_processed_block below its walk
 * start, or the atomicProgress replay guard treats a stale cursor (left by a
 * prior halted/cancelled run) as "already applied" and silently skips the
 * entire prefix into empty tables.
 *
 * Source-level guard (the full path needs a live walk; the e2e proof is the
 * prod re-run): the cursor reset must sit between the DROP SCHEMA and the
 * processBlockRange call inside reindexSubgraph.
 */
describe("fresh reindex resets the stale cursor", () => {
	test("reset is ordered after the schema drop, before the walk", async () => {
		const src = await Bun.file(
			new URL("./reindex.ts", import.meta.url).pathname,
		).text();
		const dropIdx = src.indexOf("DROP SCHEMA IF EXISTS");
		const resetIdx = src.indexOf("cursorResetTo");
		const walkIdx = src.indexOf("processBlockRange(def", dropIdx);
		expect(dropIdx).toBeGreaterThan(-1);
		expect(resetIdx).toBeGreaterThan(dropIdx);
		expect(walkIdx).toBeGreaterThan(resetIdx);
		// and the reset writes fromBlock - 1, not a constant
		expect(src.slice(dropIdx, walkIdx)).toContain("fromBlock - 1");
	});
});
