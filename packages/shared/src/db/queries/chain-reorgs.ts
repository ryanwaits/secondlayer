import { getSourceDb, sql } from "../index.ts";
import type { Database } from "../types.ts";
import type { Kysely, Transaction } from "kysely";

export type ChainReorgCursor = {
	block_height: number;
	event_index: number;
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
	since: Date | ChainReorgCursor;
	limit: number;
	db?: Kysely<Database>;
};

export type ReadChainReorgsForRangeParams = {
	from: ChainReorgCursor;
	to: ChainReorgCursor;
	db?: Kysely<Database>;
};

type ChainReorgRow = {
	id: string;
	detected_at: Date | string;
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
		row.detected_at instanceof Date
			? row.detected_at.toISOString()
			: new Date(row.detected_at).toISOString();

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

export async function readChainReorgsSince(
	params: ReadChainReorgsSinceParams,
): Promise<ChainReorgRecord[]> {
	const db = params.db ?? getSourceDb();
	const limit = Math.min(1000, Math.max(1, params.limit));

	const result =
		params.since instanceof Date
			? await sql<ChainReorgRow>`
					SELECT *
					FROM chain_reorgs
					WHERE detected_at > ${params.since}
					ORDER BY detected_at ASC, id ASC
					LIMIT ${limit}
				`.execute(db)
			: await sql<ChainReorgRow>`
					SELECT *
					FROM chain_reorgs
					WHERE
						orphaned_to_height > ${params.since.block_height}
						OR (
							orphaned_to_height = ${params.since.block_height}
							AND orphaned_to_event_index >= ${params.since.event_index}
						)
					ORDER BY detected_at ASC, id ASC
					LIMIT ${limit}
				`.execute(db);

	return result.rows.map(normalizeRow);
}

export async function readChainReorgsForRange(
	params: ReadChainReorgsForRangeParams,
): Promise<ChainReorgRecord[]> {
	const db = params.db ?? getSourceDb();
	const { from, to } = params;
	const { rows } = await sql<ChainReorgRow>`
		SELECT *
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
