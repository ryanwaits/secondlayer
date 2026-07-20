import type { Kysely, Transaction } from "kysely";
import { getSourceDb, sql } from "../index.ts";
import type { Database } from "../types.ts";

export type ChainReorgCursor = {
	block_height: number;
	event_index: number;
};

/**
 * Wall-clock resume cursor for `readChainReorgsSince`. `detected_at` is kept as
 * a raw string all the way to SQL (cast to timestamptz there) because Postgres
 * stores microseconds and a JS Date round-trip truncates to milliseconds —
 * truncation makes `detected_at > cursor` re-match the row the cursor came
 * from, re-delivering the same reorg forever. `id` breaks ties between rows
 * sharing a detected_at.
 */
export type ChainReorgTimeCursor = {
	detected_at: string;
	id: string | null;
};

export type ChainReorgRecord = {
	id: string;
	detected_at: string;
	fork_point_height: number;
	old_index_block_hash: string | null;
	new_index_block_hash: string | null;
	orphaned_range: { from: string; to: string };
	new_canonical_tip: string;
};

export type InsertChainReorgParams = {
	forkPointHeight: number;
	oldIndexBlockHash?: string | null;
	newIndexBlockHash?: string | null;
	orphanedFrom: ChainReorgCursor;
	orphanedTo: ChainReorgCursor;
	newCanonicalTip: ChainReorgCursor;
	db?: Kysely<Database> | Transaction<Database>;
};

export type ReadChainReorgsSinceParams = {
	since: Date | ChainReorgTimeCursor | ChainReorgCursor;
	limit: number;
	db?: Kysely<Database>;
};

export type ReadChainReorgsForRangeParams = {
	from: ChainReorgCursor;
	to: ChainReorgCursor;
	db?: Kysely<Database>;
};

export type ReadChainReorgsForHeightRangeParams = {
	fromHeight: number;
	toHeight: number;
	db?: Kysely<Database>;
};

type ChainReorgRow = {
	id: string;
	detected_at: Date | string;
	/** Microsecond-precision ISO text, selected alongside `detected_at` where
	 *  the value feeds a resume cursor (pg's Date parsing drops microseconds). */
	detected_at_us?: string;
	fork_point_height: string | number;
	old_index_block_hash: string | null;
	new_index_block_hash: string | null;
	orphaned_from_height: string | number;
	orphaned_from_event_index: string | number;
	orphaned_to_height: string | number;
	orphaned_to_event_index: string | number;
	new_canonical_height: string | number;
	new_canonical_event_index: string | number;
};

export function encodeChainReorgCursor(cursor: ChainReorgCursor): string {
	return `${cursor.block_height}:${cursor.event_index}`;
}

function normalizeRow(row: ChainReorgRow): ChainReorgRecord {
	const detectedAt =
		row.detected_at_us ??
		(row.detected_at instanceof Date
			? row.detected_at.toISOString()
			: new Date(row.detected_at).toISOString());

	return {
		id: row.id,
		detected_at: detectedAt,
		fork_point_height: Number(row.fork_point_height),
		old_index_block_hash: row.old_index_block_hash,
		new_index_block_hash: row.new_index_block_hash,
		orphaned_range: {
			from: encodeChainReorgCursor({
				block_height: Number(row.orphaned_from_height),
				event_index: Number(row.orphaned_from_event_index),
			}),
			to: encodeChainReorgCursor({
				block_height: Number(row.orphaned_to_height),
				event_index: Number(row.orphaned_to_event_index),
			}),
		},
		new_canonical_tip: encodeChainReorgCursor({
			block_height: Number(row.new_canonical_height),
			event_index: Number(row.new_canonical_event_index),
		}),
	};
}

export async function insertChainReorg(
	params: InsertChainReorgParams,
): Promise<ChainReorgRecord> {
	const db = params.db ?? getSourceDb();
	const row = await db
		.insertInto("chain_reorgs")
		.values({
			fork_point_height: params.forkPointHeight,
			old_index_block_hash: params.oldIndexBlockHash ?? null,
			new_index_block_hash: params.newIndexBlockHash ?? null,
			orphaned_from_height: params.orphanedFrom.block_height,
			orphaned_from_event_index: params.orphanedFrom.event_index,
			orphaned_to_height: params.orphanedTo.block_height,
			orphaned_to_event_index: params.orphanedTo.event_index,
			new_canonical_height: params.newCanonicalTip.block_height,
			new_canonical_event_index: params.newCanonicalTip.event_index,
		})
		.returningAll()
		.executeTakeFirstOrThrow();

	return normalizeRow(row);
}

/** Microsecond-precision ISO text for `detected_at`. Selected wherever the
 *  value can feed a resume cursor: pg parses timestamptz into a JS Date, which
 *  drops microseconds, and a truncated cursor re-matches the row it came from. */
const detectedAtUs = sql<string>`to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function readChainReorgsSince(
	params: ReadChainReorgsSinceParams,
): Promise<ChainReorgRecord[]> {
	const db = params.db ?? getSourceDb();
	const limit = Math.min(1000, Math.max(1, params.limit));
	const { since } = params;

	if (since instanceof Date || "detected_at" in since) {
		const cursor: ChainReorgTimeCursor =
			since instanceof Date
				? { detected_at: since.toISOString(), id: null }
				: since;
		const result = cursor.id
			? await sql<ChainReorgRow>`
					SELECT *, ${detectedAtUs} AS detected_at_us
					FROM chain_reorgs
					WHERE (detected_at, id) > (${cursor.detected_at}::timestamptz, ${cursor.id}::uuid)
					ORDER BY detected_at ASC, id ASC
					LIMIT ${limit}
				`.execute(db)
			: await sql<ChainReorgRow>`
					SELECT *, ${detectedAtUs} AS detected_at_us
					FROM chain_reorgs
					WHERE detected_at > ${cursor.detected_at}::timestamptz
					ORDER BY detected_at ASC, id ASC
					LIMIT ${limit}
				`.execute(db);
		return result.rows.map(normalizeRow);
	}

	const result = await sql<ChainReorgRow>`
		SELECT *, ${detectedAtUs} AS detected_at_us
		FROM chain_reorgs
		WHERE
			orphaned_to_height > ${since.block_height}
			OR (
				orphaned_to_height = ${since.block_height}
				AND orphaned_to_event_index >= ${since.event_index}
			)
		ORDER BY detected_at ASC, id ASC
		LIMIT ${limit}
	`.execute(db);

	return result.rows.map(normalizeRow);
}

/**
 * Reorgs overlapping the block-height window [fromHeight, toHeight], ignoring
 * event_index. For cursor keyspaces that are NOT event-indexed (the
 * transactions / contract-calls endpoints key on block_height:tx_index): a
 * height-granular overlap. Over-inclusive — a partially-orphaned height in range
 * surfaces even if the page's specific rows survived — but never under-reports.
 */
export async function readChainReorgsForHeightRange(
	params: ReadChainReorgsForHeightRangeParams,
): Promise<ChainReorgRecord[]> {
	return readChainReorgsForRange({
		from: { block_height: params.fromHeight, event_index: 0 },
		// int4 max — event_index is a Postgres `integer`, so a larger sentinel
		// (e.g. Number.MAX_SAFE_INTEGER) overflows when bound for comparison.
		to: { block_height: params.toHeight, event_index: 2_147_483_647 },
		db: params.db,
	});
}

export async function readChainReorgsForRange(
	params: ReadChainReorgsForRangeParams,
): Promise<ChainReorgRecord[]> {
	const db = params.db ?? getSourceDb();
	const { from, to } = params;
	const { rows } = await sql<ChainReorgRow>`
		SELECT *, ${detectedAtUs} AS detected_at_us
		FROM chain_reorgs
		WHERE
			(
				orphaned_from_height < ${to.block_height}
				OR (
					orphaned_from_height = ${to.block_height}
					AND orphaned_from_event_index <= ${to.event_index}
				)
			)
			AND (
				orphaned_to_height > ${from.block_height}
				OR (
					orphaned_to_height = ${from.block_height}
					AND orphaned_to_event_index >= ${from.event_index}
				)
			)
		ORDER BY detected_at ASC, id ASC
	`.execute(db);

	return rows.map(normalizeRow);
}
