import {
	readCanonicalStreamsEvents,
	STREAMS_EVENT_TYPES,
	type ReadCanonicalStreamsEventsParams,
	type ReadCanonicalStreamsEventsResult,
	type StreamsEventType,
} from "@secondlayer/indexer/streams-events";
import { ValidationError } from "@secondlayer/shared/errors";
import { decodeStreamsCursor, type StreamsCursorInput } from "./cursor.ts";
import type { StreamsTip } from "./tip.ts";

export type StreamsEventsReader = (
	params: ReadCanonicalStreamsEventsParams,
) => Promise<ReadCanonicalStreamsEventsResult>;

export type StreamsEventsQuery = {
	cursor?: StreamsCursorInput;
	cursorRaw?: string;
	fromHeight?: number;
	toHeight: number;
	types?: readonly StreamsEventType[];
	limit: number;
	cursorPastTip: boolean;
};

const STREAMS_EVENT_TYPE_SET = new Set<string>(STREAMS_EVENT_TYPES);

function parseNonNegativeInteger(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	return parsed;
}

function parseCursor(value: string): StreamsCursorInput {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 100;
	const parsed = parseNonNegativeInteger(value, "limit");
	return Math.min(1000, Math.max(1, parsed));
}

function parseTypes(value: string | undefined): readonly StreamsEventType[] | undefined {
	if (value === undefined) return undefined;
	const types = value.split(",").map((part) => part.trim());
	if (types.length === 0 || types.some((type) => type.length === 0)) {
		throw new ValidationError("types must be a comma-separated list");
	}

	const unknown = types.filter((type) => !STREAMS_EVENT_TYPE_SET.has(type));
	if (unknown.length > 0) {
		throw new ValidationError(`Unknown Streams event type: ${unknown[0]}`);
	}

	return types as StreamsEventType[];
}

export function getClampedStreamsTipHeight(tip: StreamsTip): number {
	return Math.max(0, tip.block_height - tip.lag_seconds);
}

export function parseStreamsEventsQuery(
	query: URLSearchParams,
	tip: StreamsTip,
): StreamsEventsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromHeightRaw = query.get("from_height") ?? undefined;

	if (cursorRaw && fromHeightRaw !== undefined) {
		throw new ValidationError("cursor and from_height are mutually exclusive");
	}

	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const fromHeight =
		fromHeightRaw !== undefined
			? parseNonNegativeInteger(fromHeightRaw, "from_height")
			: undefined;
	const requestedToHeight =
		query.get("to_height") !== null
			? parseNonNegativeInteger(query.get("to_height") as string, "to_height")
			: undefined;
	const clampedTipHeight = getClampedStreamsTipHeight(tip);
	const toHeight =
		requestedToHeight === undefined
			? clampedTipHeight
			: Math.min(requestedToHeight, clampedTipHeight);

	return {
		cursor,
		cursorRaw,
		fromHeight,
		toHeight,
		types: parseTypes(query.get("types") ?? undefined),
		limit: parseLimit(query.get("limit") ?? undefined),
		cursorPastTip: cursor ? cursor.block_height > clampedTipHeight : false,
	};
}

export async function getStreamsEventsResponse(opts: {
	query: URLSearchParams;
	tip: StreamsTip;
	readEvents?: StreamsEventsReader;
}) {
	const parsed = parseStreamsEventsQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			events: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorg: null,
		};
	}

	const readEvents = opts.readEvents ?? readCanonicalStreamsEvents;
	const result = await readEvents({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		types: parsed.types,
		limit: parsed.limit,
	});

	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorg: null,
	};
}
