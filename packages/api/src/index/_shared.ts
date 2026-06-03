import { ValidationError } from "@secondlayer/shared/errors";
import { decodeStreamsCursor } from "../streams/cursor.ts";
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

export function parseNonNegativeInteger(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	return parsed;
}

export function parseCursor(value: string): IndexCursorInput {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}

export function parseLimit(value: string | undefined): number {
	if (value === undefined) return 200;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new ValidationError("limit must be a positive integer");
	}
	return Math.min(1000, parsed);
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

/** Shared cursor / height-window parsing for every Index read endpoint.
 *  Resolves cursor vs from_height precedence and the default last-day window. */
export type IndexBaseQuery = {
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	cursorPastTip: boolean;
};

export function parseIndexBaseQuery(
	query: URLSearchParams,
	tip: IndexTip,
): IndexBaseQuery {
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

	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
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
		cursorPastTip: cursor ? cursor.block_height > tip.block_height : false,
	};
}

/** Resolve overlapping reorgs for the [first, last] event range of a page.
 *  Empty page → no reorg lookup. */
export async function readReorgsForEvents(
	events: ReadonlyArray<{ block_height: number; event_index: number }>,
	readReorgs?: StreamsReorgsReader,
): Promise<StreamsReorg[]> {
	const reader = readReorgs ?? EMPTY_STREAMS_REORGS_READER;
	const firstEvent = events.at(0);
	const lastEvent = events.at(-1);
	if (!firstEvent || !lastEvent) return [];
	return reader({
		from: {
			block_height: firstEvent.block_height,
			event_index: firstEvent.event_index,
		},
		to: {
			block_height: lastEvent.block_height,
			event_index: lastEvent.event_index,
		},
	});
}
