import { decodeClarityValue } from "@secondlayer/sdk";
import {
	EMPTY_RANGE_EVENT_INDEX_SENTINEL,
	encodeStreamsCursor,
	normalizeBtcTxid,
} from "@secondlayer/shared";
import { sql } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	parseCursor,
	parseNonNegativeInteger,
	parseLimit as parseSharedLimit,
} from "../parse-query.ts";
import {
	EMPTY_STREAMS_REORGS_READER,
	type StreamsReorg,
	type StreamsReorgsReader,
} from "../streams/reorgs.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import type { IndexTip } from "./tip.ts";

export type IndexCursorInput = {
	block_height: number;
	event_index: number;
};

export type IndexTxCursorInput = {
	block_height: number;
	tx_index: number;
};

export function parseTxIndexCursor(value: string): IndexTxCursorInput {
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
	if (!match) {
		throw new ValidationError("cursor must use <block_height>:<tx_index>");
	}
	const blockHeight = Number(match[1]);
	const txIndex = Number(match[2]);
	if (!Number.isSafeInteger(blockHeight) || !Number.isSafeInteger(txIndex)) {
		throw new ValidationError("cursor must use <block_height>:<tx_index>");
	}
	return { block_height: blockHeight, tx_index: txIndex };
}

/** function_args is a JSONB array of hex-encoded ClarityValues. The string
 *  branch covers pre-2026-08-12 rows that were stored double-encoded;
 *  post-backfill rows arrive as arrays. Shared by
 *  the contract-calls, transactions and mempool readers. */
export function decodeClarityArgs(raw: unknown): unknown[] {
	let parsed = raw;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.map((arg) =>
		typeof arg === "string" ? decodeClarityValue(arg) : arg,
	);
}

const RESPONSE_OK_PREFIX = "07";
const RESPONSE_ERR_PREFIX = "08";

/**
 * raw_result hex → decoded value; null or empty (`0x`) → null. A top-level
 * response keeps its branch as `{ ok: value }` / `{ err: value }` — the plain
 * decode unwraps it, so `(ok u6009)` and `(err u6009)` both read `"6009"`.
 */
export function decodeClarityResult(raw: string | null): unknown {
	if (typeof raw !== "string" || raw.length <= 2) return null;
	const decoded = decodeClarityValue(raw);
	const prefix = (
		raw.startsWith("0x") ? raw.slice(2, 4) : raw.slice(0, 2)
	).toLowerCase();
	// decodeClarityValue echoes the input hex when it can't decode.
	if (decoded === raw) return decoded;
	if (prefix === RESPONSE_OK_PREFIX) return { ok: decoded };
	if (prefix === RESPONSE_ERR_PREFIX) return { err: decoded };
	return decoded;
}

export { parseCursor, parseNonNegativeInteger };

export function parseLimit(value: string | undefined): number {
	return parseSharedLimit(value, 200);
}

export function parseFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
	}
	return value;
}

export function parseBtcTxidFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	const raw = parseFilter(value, name);
	if (raw === undefined) return undefined;
	const txid = normalizeBtcTxid(raw);
	if (txid === null) {
		throw new ValidationError(
			`${name} must be a 64-character hex Bitcoin txid (0x optional)`,
		);
	}
	return txid;
}

/** Largest contract-id set a single read may scope to. Generous for "watch my
 *  protocol's contracts", small enough that the `IN` list can't become a
 *  planner problem or a way to smuggle an unbounded query through. */
export const MAX_CONTRACT_IDS = 20;

/**
 * Parse a single-or-comma-list filter into a normalized array. Mirrors the
 * Streams parser's wire format (`?contract_id=a,b,c`) so the two surfaces
 * don't disagree about what a list looks like.
 */
export function parseListFilter(
	value: string | undefined,
	name: string,
	maxItems = MAX_CONTRACT_IDS,
): string[] | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
	}
	const items = value.split(",").map((part) => part.trim());
	if (items.some((item) => item.length === 0)) {
		throw new ValidationError(`${name} must be a comma-separated list`);
	}
	if (items.length > maxItems) {
		throw new ValidationError(
			`${name} accepts at most ${maxItems} values (got ${items.length})`,
		);
	}
	return [...new Set(items)];
}

export function toIsoOrNull(
	value: Date | string | null | undefined,
): string | null {
	if (!value) return null;
	if (value instanceof Date) return value.toISOString();
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Deep-convert BigInt → string so decoded Clarity values are JSON-serializable.
 * `cvToValue` yields a bigint for Clarity uint/int, which throws in
 * `JSON.stringify` (both `c.json` and the ETag computation). Applied to decoded
 * contract-call args/result before they enter a response.
 */
export function jsonSafeBigInt<T>(value: T): T {
	if (typeof value === "bigint") return value.toString() as unknown as T;
	if (Array.isArray(value)) {
		return value.map((v) => jsonSafeBigInt(v)) as unknown as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = jsonSafeBigInt(v);
		return out as unknown as T;
	}
	return value;
}

export { encodeStreamsCursor as encodeIndexCursor } from "@secondlayer/shared";

export type IndexOrder = "asc" | "desc";

/** Marks a cursor issued by a `desc` page. Asc cursors stay the bare
 *  `<block_height>:<event_index>` format; a desc cursor carries its direction
 *  so it can't be replayed under the other order, which would re-read the
 *  rows it already returned. */
const DESC_CURSOR_PREFIX = "desc:";

export function encodeOrderedCursor(
	cursor: IndexCursorInput,
	order: IndexOrder | undefined,
): string {
	const raw = encodeStreamsCursor(cursor);
	return order === "desc" ? `${DESC_CURSOR_PREFIX}${raw}` : raw;
}

export function keysetOp(order: IndexOrder | undefined) {
	return order === "desc" ? sql`<` : sql`>`;
}

export function sortDirection(order: IndexOrder | undefined) {
	return order === "desc" ? sql`DESC` : sql`ASC`;
}

export function parseOrder(value: string | undefined): IndexOrder {
	if (value === undefined || value === "asc") return "asc";
	if (value === "desc") return "desc";
	throw new ValidationError("order must be asc or desc");
}

function cursorForOrder(raw: string, order: IndexOrder): string {
	const issuedFor: IndexOrder = raw.startsWith(DESC_CURSOR_PREFIX)
		? "desc"
		: "asc";
	if (issuedFor !== order) {
		throw new ValidationError(
			`cursor was issued for order=${issuedFor}, but this request is order=${order}; resume with the next_cursor a page in the same order returned`,
		);
	}
	return order === "desc" ? raw.slice(DESC_CURSOR_PREFIX.length) : raw;
}

export type IndexBaseQuery<C = IndexCursorInput> = {
	cursor?: C;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	order: IndexOrder;
	cursorPastTip: boolean;
};

export function parseIndexBaseQuery<
	C extends { block_height: number } = IndexCursorInput,
>(
	query: URLSearchParams,
	tip: IndexTip,
	parseCursorValue: (raw: string) => C = parseCursor as unknown as (
		raw: string,
	) => C,
): IndexBaseQuery<C> {
	const cursorParamRaw = query.get("cursor") ?? undefined;
	const fromCursorRaw = query.get("from_cursor") ?? undefined;
	if (cursorParamRaw !== undefined && fromCursorRaw !== undefined) {
		throw new ValidationError("cursor and from_cursor are mutually exclusive");
	}

	const cursorRaw = fromCursorRaw ?? cursorParamRaw;
	const fromHeightRaw = query.get("from_height") ?? undefined;

	if (cursorRaw && fromHeightRaw !== undefined) {
		throw new ValidationError("cursor and from_height are mutually exclusive");
	}

	// Routes without `order` refuse the param before this parse, so they always
	// resolve to asc.
	const order = parseOrder(query.get("order") ?? undefined);
	const cursor = cursorRaw
		? parseCursorValue(cursorForOrder(cursorRaw, order))
		: undefined;
	const requestedFromHeight =
		fromHeightRaw !== undefined
			? parseNonNegativeInteger(fromHeightRaw, "from_height")
			: undefined;
	const requestedToHeight =
		query.get("to_height") !== null
			? parseNonNegativeInteger(query.get("to_height") as string, "to_height")
			: undefined;
	const defaultFromHeight =
		cursorRaw === undefined && fromHeightRaw === undefined
			? Math.max(0, tip.block_height - STREAMS_BLOCKS_PER_DAY)
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromHeight: requestedFromHeight ?? defaultFromHeight ?? 0,
		toHeight:
			requestedToHeight === undefined
				? tip.block_height
				: Math.min(requestedToHeight, tip.block_height),
		limit: parseLimit(query.get("limit") ?? undefined),
		order,
		// Only a forward read can run ahead of the tip; a desc cursor pages down
		// from wherever it sits.
		cursorPastTip:
			order === "asc" && cursor
				? cursor.block_height > tip.block_height
				: false,
	};
}

/** `next_cursor` for an event page, nulled once the requested range is done:
 *  a short page (fewer rows than `limit`) that read desc (reached
 *  from_height) or asc to a `to_height` below the tip. Asc reads up to the
 *  tip keep their cursor so live followers resume from it. */
export function rangeAwareNextCursor(opts: {
	nextCursor: string | null;
	rowCount: number;
	limit: number;
	order: IndexOrder;
	toHeight: number;
	tipHeight: number;
}): string | null {
	if (opts.rowCount >= opts.limit) return opts.nextCursor;
	if (opts.order === "desc") return null;
	if (opts.toHeight < opts.tipHeight) return null;
	return opts.nextCursor;
}

/** Resolve overlapping reorgs for the [first, last] event range of a page.
 *  Empty page → no reorg lookup.
 *
 *  `overlap: "height"` ignores event_index (int4-max on the page's last
 *  height). VM pages key on `ordinal`, a second clock; comparing
 *  those ordinals to classic reorg bounds hides a reorg that ended at
 *  classic `H:0` from a VM page at `H:5`. */
export async function readReorgsForEvents(
	events: ReadonlyArray<{ block_height: number; event_index: number }>,
	readReorgs?: StreamsReorgsReader,
	opts?: { overlap?: "cursor" | "height" },
): Promise<StreamsReorg[]> {
	const reader = readReorgs ?? EMPTY_STREAMS_REORGS_READER;
	const head = events.at(0);
	const tail = events.at(-1);
	if (!head || !tail) return [];
	const [firstEvent, lastEvent] =
		head.block_height > tail.block_height ||
		(head.block_height === tail.block_height &&
			head.event_index > tail.event_index)
			? [tail, head]
			: [head, tail];
	const byHeight = opts?.overlap === "height";
	return reader({
		from: {
			block_height: firstEvent.block_height,
			event_index: byHeight ? 0 : firstEvent.event_index,
		},
		to: {
			block_height: lastEvent.block_height,
			event_index: byHeight
				? EMPTY_RANGE_EVENT_INDEX_SENTINEL
				: lastEvent.event_index,
		},
	});
}
