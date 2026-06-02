import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	encodeIndexCursor,
	parseIndexBaseQuery,
	toIsoOrNull,
} from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

/** Window/pagination params the blocks list accepts. Blocks carry no content
 *  filters — height is the only axis. */
export const BLOCKS_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
] as const;

/**
 * A block resource. Metadata is intentionally thin — the ingest schema stores
 * only the chain-linkage and burn-anchor fields, not miner / tx_count / signer /
 * execution-cost data. We expose exactly what we persist rather than fabricate
 * absent fields; richer block metadata would require an ingest change.
 */
export type IndexBlock = {
	cursor: string;
	block_height: number;
	block_hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	block_time: string | null;
	canonical: boolean;
};

export type BlocksResponse = {
	blocks: IndexBlock[];
	next_cursor: string | null;
	tip: IndexTip;
};

export type ReadBlocksParams = {
	after?: { block_height: number };
	fromHeight: number;
	toHeight: number;
	limit: number;
	db?: Kysely<Database>;
};

export type ReadBlocksResult = {
	blocks: IndexBlock[];
	next_cursor: string | null;
};

export type BlocksReader = (
	params: ReadBlocksParams,
) => Promise<ReadBlocksResult>;

export type BlockByRefReader = (ref: string) => Promise<IndexBlock | null>;

const BLOCK_COLUMNS = [
	"height",
	"hash",
	"parent_hash",
	"burn_block_height",
	"burn_block_hash",
	"timestamp",
	"canonical",
] as const;

type BlockRow = {
	height: number | string;
	hash: string;
	parent_hash: string;
	burn_block_height: number | string;
	burn_block_hash: string | null;
	timestamp: number | string;
	canonical: boolean;
};

function normalizeBlock(row: BlockRow): IndexBlock {
	const blockHeight = Number(row.height);
	return {
		cursor: encodeIndexCursor({ block_height: blockHeight, event_index: 0 }),
		block_height: blockHeight,
		block_hash: row.hash,
		parent_hash: row.parent_hash,
		burn_block_height: Number(row.burn_block_height),
		burn_block_hash: row.burn_block_hash ?? null,
		block_time: toIsoOrNull(new Date(Number(row.timestamp) * 1000)),
		canonical: row.canonical,
	};
}

/** Canonical-only block list, ordered by height. Cursor shares the Index
 *  `height:n` shape (event_index pinned to 0). */
export async function readBlocks(
	params: ReadBlocksParams,
): Promise<ReadBlocksResult> {
	if (params.toHeight < params.fromHeight) {
		return { blocks: [], next_cursor: null };
	}

	const db = params.db ?? getSourceDb();
	let query = db
		.selectFrom("blocks")
		.select(BLOCK_COLUMNS)
		.where("canonical", "=", true)
		.where("height", ">=", params.fromHeight)
		.where("height", "<=", params.toHeight);

	if (params.after) {
		query = query.where("height", ">", params.after.block_height);
	}

	const rows = await query
		.orderBy("height", "asc")
		.limit(params.limit)
		.execute();

	const blocks = rows.map(normalizeBlock);
	const last = blocks.at(-1);
	return { blocks, next_cursor: last ? last.cursor : null };
}

/** Fetch a single block by height (numeric → canonical block at that height) or
 *  by hash (returns the block regardless of canonicality, so callers can detect
 *  an orphaned hash via the `canonical` flag). */
export async function readBlockByRef(
	ref: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<IndexBlock | null> {
	const isHeight = /^(0|[1-9]\d*)$/.test(ref);
	let query = db.selectFrom("blocks").select(BLOCK_COLUMNS);

	query = isHeight
		? query.where("height", "=", Number(ref)).where("canonical", "=", true)
		: query.where("hash", "=", ref);

	const row = await query.orderBy("height", "desc").limit(1).executeTakeFirst();
	return row ? normalizeBlock(row) : null;
}

export async function getBlocksResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readBlocks?: BlocksReader;
}): Promise<BlocksResponse> {
	const base = parseIndexBaseQuery(opts.query, opts.tip);

	if (base.cursorPastTip) {
		return { blocks: [], next_cursor: base.cursorRaw ?? null, tip: opts.tip };
	}

	const reader = opts.readBlocks ?? readBlocks;
	const result = await reader({
		after: base.cursor ? { block_height: base.cursor.block_height } : undefined,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
	});

	return {
		blocks: result.blocks,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
