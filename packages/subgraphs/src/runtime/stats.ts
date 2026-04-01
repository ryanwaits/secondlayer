import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import type { ProcessBlockTiming } from "./block-processor.ts";

interface StatsEntry {
	subgraphName: string;
	apiKeyId: string | null;
	bucketStart: Date;
	blocksProcessed: number;
	totalTimeMs: number;
	handlerTimeMs: number;
	flushTimeMs: number;
	maxBlockTimeMs: number;
	maxHandlerTimeMs: number;
	totalOps: number;
	isCatchup: boolean;
}

const FLUSH_INTERVAL_BLOCKS = 100;
const FLUSH_INTERVAL_MS = 60_000;

/**
 * Accumulates per-block timing stats and flushes to DB periodically.
 * One instance per subgraph during catchup/reindex/live processing.
 */
export class StatsAccumulator {
	private current: StatsEntry;
	private lastFlush = Date.now();

	constructor(
		private subgraphName: string,
		private apiKeyId: string | null,
		private isCatchup: boolean,
	) {
		this.current = this.newEntry();
	}

	record(timing: ProcessBlockTiming, opsCount: number): void {
		this.current.blocksProcessed++;
		this.current.totalTimeMs += timing.totalMs;
		this.current.handlerTimeMs += timing.handlerMs;
		this.current.flushTimeMs += timing.flushMs;
		this.current.maxBlockTimeMs = Math.max(
			this.current.maxBlockTimeMs,
			timing.totalMs,
		);
		this.current.maxHandlerTimeMs = Math.max(
			this.current.maxHandlerTimeMs,
			timing.handlerMs,
		);
		this.current.totalOps += opsCount;
	}

	shouldFlush(): boolean {
		return (
			this.current.blocksProcessed >= FLUSH_INTERVAL_BLOCKS ||
			Date.now() - this.lastFlush >= FLUSH_INTERVAL_MS
		);
	}

	async flush(db: Kysely<Database>): Promise<void> {
		if (this.current.blocksProcessed === 0) return;

		const entry = this.current;
		this.current = this.newEntry();
		this.lastFlush = Date.now();

		const avgOpsPerBlock =
			entry.blocksProcessed > 0 ? entry.totalOps / entry.blocksProcessed : 0;

		await db
			.insertInto("subgraph_processing_stats")
			.values({
				subgraph_name: entry.subgraphName,
				api_key_id: entry.apiKeyId,
				bucket_start: entry.bucketStart,
				bucket_end: new Date(),
				blocks_processed: entry.blocksProcessed,
				total_time_ms: Math.round(entry.totalTimeMs),
				handler_time_ms: Math.round(entry.handlerTimeMs),
				flush_time_ms: Math.round(entry.flushTimeMs),
				max_block_time_ms: Math.round(entry.maxBlockTimeMs),
				max_handler_time_ms: Math.round(entry.maxHandlerTimeMs),
				avg_ops_per_block: Number.parseFloat(avgOpsPerBlock.toFixed(2)),
				is_catchup: entry.isCatchup,
			})
			.execute();
	}

	private newEntry(): StatsEntry {
		return {
			subgraphName: this.subgraphName,
			apiKeyId: this.apiKeyId,
			bucketStart: new Date(),
			blocksProcessed: 0,
			totalTimeMs: 0,
			handlerTimeMs: 0,
			flushTimeMs: 0,
			maxBlockTimeMs: 0,
			maxHandlerTimeMs: 0,
			totalOps: 0,
			isCatchup: this.isCatchup,
		};
	}
}
