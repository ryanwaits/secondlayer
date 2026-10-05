// Bun --preload for the benchmark stacks only: prints one JSON line per
// processed block (the per-block timing the processor already measures but
// only exposes as 100-block aggregates). Patches the stats accumulator; no
// product code changes. totalMs is rounded to whole ms by block-processor.
import { StatsAccumulator } from "/app/packages/subgraphs/src/runtime/stats.ts";

const original = StatsAccumulator.prototype.record;
StatsAccumulator.prototype.record = function (timing, opsCount) {
	console.log(
		JSON.stringify({
			bench: "block",
			totalMs: timing.totalMs,
			handlerMs: timing.handlerMs,
			flushMs: timing.flushMs,
			ops: opsCount,
		}),
	);
	return original.call(this, timing, opsCount);
};
