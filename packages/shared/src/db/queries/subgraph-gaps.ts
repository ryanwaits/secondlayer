import { type Kysely, sql } from "kysely";
import type { Database, GapReason } from "../types.ts";

export interface GapRange {
	start: number;
	end: number;
	reason: GapReason;
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

/** Serializes writers of one subgraph's gap rows for the rest of the
 *  transaction, so two of them can never both decide a range is uncovered. */
async function lockGaps(db: Kysely<Database>, subgraphId: string) {
	await sql`SELECT pg_advisory_xact_lock(hashtext(${`subgraph-gaps:${subgraphId}`}))`.execute(
		db,
	);
}

/** Runs `fn` in a transaction, or in the caller's when it already has one. */
function inTransaction<T>(
	db: Kysely<Database>,
	fn: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
	return db.isTransaction ? fn(db) : db.transaction().execute(fn);
}

type Span = { start: number; end: number };

/** `span` minus every range in `taken`: the pieces nothing covers yet. */
function uncovered(span: Span, taken: Span[]): Span[] {
	const pieces: Span[] = [];
	let cursor = span.start;
	for (const t of [...taken].sort((a, b) => a.start - b.start)) {
		if (t.end < cursor) continue;
		if (t.start > span.end) break;
		if (t.start > cursor) pieces.push({ start: cursor, end: t.start - 1 });
		cursor = Math.max(cursor, t.end + 1);
	}
	if (cursor <= span.end) pieces.push({ start: cursor, end: span.end });
	return pieces;
}

/**
 * Batch-insert gap ranges for a subgraph. Only the part of each range that no
 * unresolved gap covers is inserted, so gap rows never overlap and the summaries
 * (which sum sizes) never count a block twice. Callers should still coalesce
 * contiguous skipped blocks into ranges before calling.
 */
export async function recordGapBatch(
	db: Kysely<Database>,
	subgraphId: string,
	subgraphName: string,
	gaps: GapRange[],
): Promise<void> {
	if (gaps.length === 0) return;
	for (const g of gaps) {
		if (g.start > g.end) {
			throw new Error(
				`Invalid gap range ${g.start}-${g.end}: start is after end`,
			);
		}
	}

	await inTransaction(db, async (trx) => {
		await lockGaps(trx, subgraphId);
		const existing = (
			await trx
				.selectFrom("subgraph_gaps")
				.select(["gap_start", "gap_end"])
				.where("subgraph_id", "=", subgraphId)
				.where("resolved_at", "is", null)
				.where("gap_start", "<=", Math.max(...gaps.map((g) => g.end)))
				.where("gap_end", ">=", Math.min(...gaps.map((g) => g.start)))
				.execute()
		).map((r) => ({ start: Number(r.gap_start), end: Number(r.gap_end) }));

		// Each insert also counts as taken for the ones after it in the batch.
		const taken = [...existing];
		const rows: Array<{
			subgraph_id: string;
			subgraph_name: string;
			gap_start: number;
			gap_end: number;
			reason: GapReason;
		}> = [];
		for (const g of gaps) {
			for (const piece of uncovered({ start: g.start, end: g.end }, taken)) {
				taken.push(piece);
				rows.push({
					subgraph_id: subgraphId,
					subgraph_name: subgraphName,
					gap_start: piece.start,
					gap_end: piece.end,
					reason: g.reason,
				});
			}
		}
		if (rows.length > 0) {
			await trx.insertInto("subgraph_gaps").values(rows).execute();
		}
	});
}

/**
 * List gaps for a subgraph with computed size.
 */
export async function findSubgraphGaps(
	db: Kysely<Database>,
	subgraphId: string,
	opts?: { limit?: number; offset?: number; unresolvedOnly?: boolean },
): Promise<{ gaps: SubgraphGapRow[]; total: number }> {
	const limit = opts?.limit ?? 50;
	const offset = opts?.offset ?? 0;
	const unresolvedOnly = opts?.unresolvedOnly ?? true;

	let baseQuery = db
		.selectFrom("subgraph_gaps")
		.where("subgraph_id", "=", subgraphId);

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
 *
 * A gap inside [fromBlock, toBlock] is resolved whole. One that only partly
 * overlaps is resolved too, and what the range does not cover is reopened as
 * gaps of its own, so a walk over part of a gap repairs exactly that part.
 * With `detectedBefore`, gaps recorded at or after it stay open: a walk passes
 * its own start time (from the database clock) so a block that failed during
 * the walk is not resolved by the walk that just recorded it.
 */
export async function resolveGaps(
	db: Kysely<Database>,
	subgraphId: string,
	fromBlock: number,
	toBlock: number,
	opts?: { detectedBefore?: Date },
): Promise<number> {
	return inTransaction(db, async (trx) => {
		await lockGaps(trx, subgraphId);
		let q = trx
			.selectFrom("subgraph_gaps")
			.selectAll()
			.where("subgraph_id", "=", subgraphId)
			.where("resolved_at", "is", null)
			.where("gap_start", "<=", toBlock)
			.where("gap_end", ">=", fromBlock);
		if (opts?.detectedBefore) {
			q = q.where("detected_at", "<", opts.detectedBefore);
		}
		const hit = await q.execute();
		if (hit.length === 0) return 0;

		await trx
			.updateTable("subgraph_gaps")
			.set({ resolved_at: new Date() })
			.where(
				"id",
				"in",
				hit.map((g) => g.id),
			)
			.execute();

		const reopened = hit.flatMap((g) => {
			const start = Number(g.gap_start);
			const end = Number(g.gap_end);
			const keep: Span[] = [];
			if (start < fromBlock) keep.push({ start, end: fromBlock - 1 });
			if (end > toBlock) keep.push({ start: toBlock + 1, end });
			return keep.map((k) => ({
				subgraph_id: g.subgraph_id,
				subgraph_name: g.subgraph_name,
				gap_start: k.start,
				gap_end: k.end,
				reason: g.reason,
				detected_at: g.detected_at,
			}));
		});
		if (reopened.length > 0) {
			await trx.insertInto("subgraph_gaps").values(reopened).execute();
		}
		return hit.length;
	});
}

/**
 * Total missing blocks across unresolved gaps for a subgraph.
 */
export async function countSubgraphMissingBlocks(
	db: Kysely<Database>,
	subgraphId: string,
): Promise<number> {
	const { rows } = await sql<{ total: string }>`
    SELECT COALESCE(SUM(gap_end - gap_start + 1), 0) AS total
    FROM subgraph_gaps
    WHERE subgraph_id = ${subgraphId}
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
