import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { encodeIndexCursor, parseIndexBaseQuery } from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

/** Window/pagination params the canonical map accepts. No content filters: the
 *  map is a lean sync primitive keyed purely on height. */
export const CANONICAL_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
] as const;

/**
 * One canonical block in the sync map. Carries the block + parent hash (to
 * verify chain linkage) and the burn anchor (to align with Bitcoin
 * confirmations). Deliberately lean — no timestamp or metadata; `/v1/index/blocks`
 * is the full block resource. Every row is canonical by definition, so there is
 * no `is_canonical` flag.
 */
export type CanonicalBlock = {
	cursor: string;
	block_height: number;
	block_hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
};

export type CanonicalResponse = {
	canonical: CanonicalBlock[];
	next_cursor: string | null;
	tip: IndexTip;
};

export type ReadCanonicalRangeParams = {
	after?: { block_height: number };
	fromHeight: number;
	toHeight: number;
	limit: number;
	db?: Kysely<Database>;
};

export type ReadCanonicalRangeResult = {
	canonical: CanonicalBlock[];
	next_cursor: string | null;
};

export type CanonicalRangeReader = (
	params: ReadCanonicalRangeParams,
) => Promise<ReadCanonicalRangeResult>;

/** Read an ordered, canonical-only slice of the chain by height. One row per
 *  height — non-canonical (orphaned) blocks are excluded, so a client can sync
 *  only the current canonical chain. Cursor shares the Index `height:n` shape
 *  (event_index pinned to 0) so the base-query and cache machinery apply
 *  unchanged. */
export async function readCanonicalRange(
	params: ReadCanonicalRangeParams,
): Promise<ReadCanonicalRangeResult> {
	if (params.toHeight < params.fromHeight) {
		return { canonical: [], next_cursor: null };
	}

	const db = params.db ?? getSourceDb();
	let query = db
		.selectFrom("blocks")
		.select([
			"height",
			"hash",
			"parent_hash",
			"burn_block_height",
			"burn_block_hash",
		])
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

	const canonical = rows.map((row): CanonicalBlock => {
		const blockHeight = Number(row.height);
		return {
			cursor: encodeIndexCursor({ block_height: blockHeight, event_index: 0 }),
			block_height: blockHeight,
			block_hash: row.hash,
			parent_hash: row.parent_hash,
			burn_block_height: Number(row.burn_block_height),
			burn_block_hash: row.burn_block_hash ?? null,
		};
	});

	const last = canonical.at(-1);
	return { canonical, next_cursor: last ? last.cursor : null };
}

export async function getCanonicalResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readCanonical?: CanonicalRangeReader;
}): Promise<CanonicalResponse> {
	const base = parseIndexBaseQuery(opts.query, opts.tip);

	if (base.cursorPastTip) {
		return {
			canonical: [],
			next_cursor: base.cursorRaw ?? null,
			tip: opts.tip,
		};
	}

	const reader = opts.readCanonical ?? readCanonicalRange;
	const result = await reader({
		after: base.cursor ? { block_height: base.cursor.block_height } : undefined,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
	});

	return {
		canonical: result.canonical,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
