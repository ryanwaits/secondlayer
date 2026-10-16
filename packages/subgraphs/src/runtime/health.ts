import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";

export const SNAPSHOT_INTERVAL_MS = 60_000;
export const RETENTION_DAYS = 7;
export const RETENTION_SWEEP_MS = 3_600_000;

export interface HealthSnapshotInput {
	subgraphId: string;
	subgraphName: string;
	schemaName: string;
	lastProcessedBlock: number;
	chainTip: number;
	totalProcessed: number;
	totalErrors: number;
}

const lastWrittenMs = new Map<string, number>();
let lastSweepMs = 0;

/** Test seam — clears the per-process rate-limit and sweep clocks. */
export function resetHealthSnapshotState(): void {
	lastWrittenMs.clear();
	lastSweepMs = 0;
}

/**
 * Record one health snapshot per subgraph per minute, called from the catch-up
 * loop (the only place that knows both cursor and tip). Never throws: a
 * failed snapshot must not add a failure path to block processing.
 */
export async function maybeRecordHealthSnapshot(
	db: Kysely<Database>,
	input: HealthSnapshotInput,
	now: number = Date.now(),
): Promise<void> {
	try {
		const last = lastWrittenMs.get(input.subgraphId);
		if (last !== undefined && now - last < SNAPSHOT_INTERVAL_MS) return;
		lastWrittenMs.set(input.subgraphId, now);

		// Cumulative table counters: deltas between snapshots give rows written.
		const stats = await sql<{
			rows_written_total: string;
			storage_bytes: string;
		}>`
			SELECT COALESCE(SUM(n_tup_ins + n_tup_upd), 0)::bigint AS rows_written_total,
			       COALESCE(SUM(pg_total_relation_size(relid)), 0)::bigint AS storage_bytes
			FROM pg_stat_user_tables
			WHERE schemaname = ${input.schemaName}
		`.execute(db);
		const row = stats.rows[0];

		await db
			.insertInto("subgraph_health_snapshots")
			.values({
				subgraph_id: input.subgraphId,
				total_processed: input.totalProcessed,
				total_errors: input.totalErrors,
				last_processed_block: input.lastProcessedBlock,
				chain_tip: input.chainTip,
				rows_written_total: row?.rows_written_total ?? 0,
				storage_bytes: row?.storage_bytes ?? 0,
			})
			.execute();

		if (now - lastSweepMs >= RETENTION_SWEEP_MS) {
			lastSweepMs = now;
			await sql`
				DELETE FROM subgraph_health_snapshots
				WHERE captured_at < now() - make_interval(days => ${RETENTION_DAYS})
			`.execute(db);
		}
	} catch (err) {
		logger.warn("Failed to record subgraph health snapshot", {
			subgraph: input.subgraphName,
			error: err instanceof Error ? err.message : String(err),
		});
	}
}
