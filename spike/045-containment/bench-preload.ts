// Bun --preload for the benchmark stacks only: prints one JSON line per
// processed block (the per-block timing the processor already measures but
// only exposes as 100-block aggregates). Patches the stats accumulator; no
// product code changes. totalMs is rounded to whole ms by block-processor.

// Path inside the api image. Imported dynamically so root typechecking, which
// has no /app, does not try to resolve it.
const STATS_PATH = "/app/packages/subgraphs/src/runtime/stats.ts";

interface BlockTiming {
	totalMs: number;
	handlerMs: number;
	flushMs: number;
}
type RecordFn = (timing: BlockTiming, opsCount: number) => void;

const { StatsAccumulator } = (await import(STATS_PATH)) as {
	StatsAccumulator: { prototype: { record: RecordFn } };
};

const original = StatsAccumulator.prototype.record;
StatsAccumulator.prototype.record = function (
	this: unknown,
	timing: BlockTiming,
	opsCount: number,
) {
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

export {};
