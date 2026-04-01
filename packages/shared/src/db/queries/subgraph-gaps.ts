import { type Kysely, sql } from "kysely";
import type { Database } from "../types.ts";

export interface GapRange {
	start: number;
	end: number;
	reason: string;
}

export interface SubgraphGapRow {
	id: string;
	subgraphName: string;
	gapStart: number;
	gapEnd: number;
	size: number;
	reason: string;
	detectedAt: Date;
	resolvedAt: Date | null;
}

export interface GapSummary {
	subgraphName: string;
	gapCount: number;
	totalMissingBlocks: number;
}

/**
 * Batch-insert gap ranges for a subgraph. Append-only — no merge on write.
 * Callers should coalesce contiguous skipped blocks into ranges before calling.
 */
export async function recordGapBatch(
	db: Kysely<Database>,
	subgraphId: string,
	subgraphName: string,
	gaps: GapRange[],
): Promise<void> {
	if (gaps.length === 0) return;

	await db
		.insertInto("subgraph_gaps")
		.values(
			gaps.map((g) => ({
				subgraph_id: subgraphId,
				subgraph_name: subgraphName,
				gap_start: g.start,
				gap_end: g.end,
				reason: g.reason,
			})),
		)
		.execute();
}

/**
 * List gaps for a subgraph with computed size.
 */
export async function findSubgraphGaps(
	db: Kysely<Database>,
	subgraphName: string,
	opts?: { limit?: number; offset?: number; unresolvedOnly?: boolean },
): Promise<{ gaps: SubgraphGapRow[]; total: number }> {
	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;
	const unresolvedOnly = opts?.unresolvedOnly ?? true;

	let baseQuery = db
		.selectFrom("subgraph_gaps")
		.where("subgraph_name", "=", subgraphName);

	if (unresolvedOnly) {
		baseQuery = baseQuery.where("resolved_at", "is", null);
	}

	const [rows, countResult] = await Promise.all([
		baseQuery
			.select([
				"id",
				"subgraph_name",
				"gap_start",
				"gap_end",
				sql<number>`gap_end - gap_start + 1`.as("size"),
				"reason",
				"detected_at",
				"resolved_at",
			])
			.orderBy("gap_start", "asc")
			.limit(limit)
			.offset(offset)
			.execute(),
		baseQuery
			.select(sql<number>`count(*)`.as("count"))
			.executeTakeFirstOrThrow(),
	]);

	return {
		gaps: rows.map((r) => ({
			id: r.id,
			subgraphName: r.subgraph_name,
			gapStart: Number(r.gap_start),
			gapEnd: Number(r.gap_end),
			size: Number(r.size),
			reason: r.reason,
			detectedAt: r.detected_at,
			resolvedAt: r.resolved_at,
		})),
		total: Number(countResult.count),
	};
}

/**
 * Mark gaps as resolved within a block range. Idempotent.
 * Only resolves gaps fully contained within [fromBlock, toBlock].
 */
export async function resolveGaps(
	db: Kysely<Database>,
	subgraphName: string,
	fromBlock: number,
	toBlock: number,
): Promise<number> {
	const result = await db
		.updateTable("subgraph_gaps")
		.set({ resolved_at: new Date() })
		.where("subgraph_name", "=", subgraphName)
		.where("resolved_at", "is", null)
		.where("gap_start", ">=", fromBlock)
		.where("gap_end", "<=", toBlock)
		.executeTakeFirst();

	return Number(result.numUpdatedRows);
}

/**
 * Total missing blocks across unresolved gaps for a subgraph.
 */
export async function countSubgraphMissingBlocks(
	db: Kysely<Database>,
	subgraphName: string,
): Promise<number> {
	const { rows } = await sql<{ total: string }>`
    SELECT COALESCE(SUM(gap_end - gap_start + 1), 0) AS total
    FROM subgraph_gaps
    WHERE subgraph_name = ${subgraphName}
      AND resolved_at IS NULL
  `.execute(db);

	return Number(rows[0]?.total ?? 0);
}

/**
 * Aggregate gap counts + missing blocks grouped by subgraph_name.
 * Used by the /status endpoint for per-subgraph gap summary.
 */
export async function getGapSummaryBySubgraph(
	db: Kysely<Database>,
): Promise<GapSummary[]> {
	const { rows } = await sql<{
		subgraph_name: string;
		gap_count: string;
		total_missing: string;
	}>`
    SELECT
      subgraph_name,
      COUNT(*) AS gap_count,
      COALESCE(SUM(gap_end - gap_start + 1), 0) AS total_missing
    FROM subgraph_gaps
    WHERE resolved_at IS NULL
    GROUP BY subgraph_name
  `.execute(db);

	return rows.map((r) => ({
		subgraphName: r.subgraph_name,
		gapCount: Number(r.gap_count),
		totalMissingBlocks: Number(r.total_missing),
	}));
}
