import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	encodeIndexCursor,
	parseIndexBaseQuery,
	toIsoOrNull,
} from "./_shared.ts";
import {
	type IndexTip,
	committedHeightForEventTypes,
	indexSourceWindowTip,
} from "./tip.ts";

/** Window/pagination params the blocks list accepts. Blocks carry no content
 *  filters — height is the only axis. `wait` (plan-063 3.4) long-polls when
 *  the requested window has nothing new yet — see `../index/wait.ts`.
 *  `tip_only` skips the row query entirely, and `event_types` narrows which
 *  decoders that tip is judged by — see the doc on `getBlocksResponse`. */
export const BLOCKS_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"wait",
	"tip_only",
	"event_types",
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
	/**
	 * Nakamoto StacksBlockId — the identifier `?tip=` accepts on a node's
	 * call-read endpoint. Served so a consumer can pin a read-only call to
	 * exactly this block instead of the node's moving tip. Null on rows
	 * ingested before it was persisted.
	 */
	index_block_hash: string | null;
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
	"index_block_hash",
	"timestamp",
	"canonical",
] as const;

type BlockRow = {
	height: number | string;
	hash: string;
	parent_hash: string;
	burn_block_height: number | string;
	burn_block_hash: string | null;
	index_block_hash: string | null;
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
		index_block_hash: row.index_block_hash ?? null,
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

/**
 * The tip a `tip_only` request should be judged (and answered) by. Without
 * `event_types`, this is the plain global cross-decoder floor (unchanged
 * behavior). With it, narrows to the MIN committed height over just those
 * types — the same quantity `boundSourceTip` (subgraphs runtime) computes
 * client-side from `decoded_heights`, computed once here instead so the
 * `wait` emptiness check upstream (`../routes/index.ts`, which just reads
 * `response.tip.block_height`) and the value the caller ultimately uses are
 * the SAME number. Fixes the busy-idle pattern where ANY of ~15 decoders
 * committing (most of them irrelevant to the caller) moved the global floor
 * and made an unrelated wait return early: the evaluator's chain webhooks
 * reference a handful of event types, but every decoder's checkpoint write
 * NOTIFYs the same `index:tip` channel — a request that says which types it
 * actually reads is judged only by whether THOSE moved.
 *
 * Falls back to the unnarrowed tip when `event_types` is absent, unknown to
 * this server (`decoded_heights` missing), or names a type with no
 * checkpoint yet (`committedHeightForEventTypes` returns `null`) — the safe,
 * conservative default, identical to today's behavior.
 */
function tipForTipOnly(opts: {
	query: URLSearchParams;
	tip: IndexTip;
}): IndexTip {
	const raw = opts.query.get("event_types");
	if (!raw) return opts.tip;
	const eventTypes = raw
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	if (eventTypes.length === 0) return opts.tip;
	const narrowed = committedHeightForEventTypes(opts.tip, eventTypes);
	if (narrowed === null || narrowed === opts.tip.block_height) return opts.tip;
	return { ...opts.tip, block_height: narrowed };
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
	// A caller that only wants the tip (IndexHttpClient.getIndexTip/
	// getIndexSourceTip — never reads `blocks[]`) skips the row query
	// entirely: there's nothing to page, and — the reason this exists —
	// `blocks.length === 0` is governed by the SOURCE tip (`readBlocks`
	// windows to `indexSourceWindowTip`), not the decoded `tip.block_height`
	// `getIndexTip()` actually reports. A caller polling with `from_height`
	// anchored to the DECODED tip would see rows the instant the SOURCE tip
	// (which usually leads decode by a little) moved past it, even though
	// the decoded tip it's tracking hasn't — making the "empty" wait
	// condition upstream (`../routes/index.ts`) true almost every fetch and
	// defeating `wait` entirely. `tip_only` sidesteps the ambiguity: the
	// caller declares "I don't care about rows," so wait/emptiness upstream
	// is judged against `tip.block_height` directly instead.
	if (opts.query.get("tip_only") === "true") {
		return { blocks: [], next_cursor: null, tip: tipForTipOnly(opts) };
	}

	const base = parseIndexBaseQuery(opts.query, indexSourceWindowTip(opts.tip));

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
