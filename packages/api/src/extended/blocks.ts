import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

/**
 * Hiro-ish block list item. Omits miner_txid / execution_cost_* — we do not
 * persist them and do not fabricate zeros. List omits `txs` / `tx_count`.
 */
export type ExtendedBlockListItem = {
	canonical: boolean;
	height: number;
	hash: string;
	index_block_hash: string | null;
	parent_block_hash: string;
	parent_index_block_hash: string | null;
	burn_block_hash: string | null;
	burn_block_height: number;
	burn_block_time: number;
	burn_block_time_iso: string;
};

/** Single-block GET: list fields plus tx ids. */
export type ExtendedBlock = ExtendedBlockListItem & {
	txs: string[];
	tx_count: number;
};

export type ListExtendedBlocksQuery = {
	limit: number;
	offset: number;
};

export type ListExtendedBlocksResult = {
	results: ExtendedBlockListItem[];
	total: number;
};

export type ListExtendedBlocks = (
	q: ListExtendedBlocksQuery,
) => Promise<ListExtendedBlocksResult>;

export type GetExtendedBlock = (ref: string) => Promise<ExtendedBlock | null>;

type BlockRow = {
	height: number | string;
	hash: string;
	parent_hash: string;
	parent_index_block_hash: string | null;
	burn_block_height: number | string;
	burn_block_hash: string | null;
	index_block_hash: string | null;
	timestamp: number | string;
	canonical: boolean;
};

function toIsoFromUnix(unixSeconds: number): string {
	return new Date(unixSeconds * 1000).toISOString();
}

function projectListItem(row: BlockRow): ExtendedBlockListItem {
	const burnBlockTime = Number(row.timestamp);
	return {
		canonical: row.canonical,
		height: Number(row.height),
		hash: row.hash,
		index_block_hash: row.index_block_hash ?? null,
		parent_block_hash: row.parent_hash,
		parent_index_block_hash: row.parent_index_block_hash ?? null,
		burn_block_hash: row.burn_block_hash ?? null,
		burn_block_height: Number(row.burn_block_height),
		burn_block_time: burnBlockTime,
		burn_block_time_iso: toIsoFromUnix(burnBlockTime),
	};
}

/** Canonical blocks, height desc, limit/offset. No `txs`. */
export async function listExtendedBlocks(
	q: ListExtendedBlocksQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<ListExtendedBlocksResult> {
	const { rows: countRows } = await sql<{ count: string | number }>`
		SELECT COUNT(*)::bigint AS count
		FROM blocks
		WHERE canonical = true
	`.execute(db);
	const total = Number(countRows[0]?.count ?? 0);

	const { rows } = await sql<BlockRow>`
		SELECT
			b.height,
			b.hash,
			b.parent_hash,
			parent.index_block_hash AS parent_index_block_hash,
			b.burn_block_height,
			b.burn_block_hash,
			b.index_block_hash,
			b.timestamp,
			b.canonical
		FROM blocks b
		LEFT JOIN blocks parent ON parent.hash = b.parent_hash
		WHERE b.canonical = true
		ORDER BY b.height DESC
		LIMIT ${q.limit}
		OFFSET ${q.offset}
	`.execute(db);

	return {
		results: rows.map(projectListItem),
		total,
	};
}

/**
 * Height (numeric → canonical only) or hash (may be orphaned).
 * Includes `txs` ordered by tx_index. transactions has no canonical column —
 * filter via the block height matching this row.
 */
export async function getExtendedBlock(
	ref: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<ExtendedBlock | null> {
	const isHeight = /^(0|[1-9]\d*)$/.test(ref);

	const { rows } = isHeight
		? await sql<BlockRow>`
				SELECT
					b.height,
					b.hash,
					b.parent_hash,
					parent.index_block_hash AS parent_index_block_hash,
					b.burn_block_height,
					b.burn_block_hash,
					b.index_block_hash,
					b.timestamp,
					b.canonical
				FROM blocks b
				LEFT JOIN blocks parent ON parent.hash = b.parent_hash
				WHERE b.height = ${Number(ref)} AND b.canonical = true
				LIMIT 1
			`.execute(db)
		: await sql<BlockRow>`
				SELECT
					b.height,
					b.hash,
					b.parent_hash,
					parent.index_block_hash AS parent_index_block_hash,
					b.burn_block_height,
					b.burn_block_hash,
					b.index_block_hash,
					b.timestamp,
					b.canonical
				FROM blocks b
				LEFT JOIN blocks parent ON parent.hash = b.parent_hash
				WHERE b.hash = ${ref}
				ORDER BY b.height DESC
				LIMIT 1
			`.execute(db);

	const row = rows.at(0);
	if (!row) return null;

	const height = Number(row.height);
	const { rows: txRows } = await sql<{ tx_id: string }>`
		SELECT t.tx_id
		FROM transactions t
		WHERE t.block_height = ${height}
		ORDER BY t.tx_index ASC
	`.execute(db);

	const txs = txRows.map((t) => t.tx_id);
	return {
		...projectListItem(row),
		txs,
		tx_count: txs.length,
	};
}
