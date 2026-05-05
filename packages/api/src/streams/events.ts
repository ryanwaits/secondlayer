import {
	type ReadCanonicalStreamsEventsParams,
	type ReadCanonicalStreamsEventsResult,
	STREAMS_EVENT_TYPES,
	type StreamsEvent,
	type StreamsEventType,
	readCanonicalStreamsEvents,
} from "@secondlayer/indexer/streams-events";
import { ValidationError } from "@secondlayer/shared/errors";
import { type StreamsCursorInput, decodeStreamsCursor } from "./cursor.ts";
import {
	EMPTY_STREAMS_REORGS_READER,
	type StreamsReorg,
	type StreamsReorgsReader,
} from "./reorgs.ts";
import { STREAMS_BLOCKS_PER_DAY } from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

export type StreamsEventsReader = (
	params: ReadCanonicalStreamsEventsParams,
) => Promise<ReadCanonicalStreamsEventsResult>;

export type StreamsEventsQuery = {
	/**
	 * Explicit cursor wins over the server default window. `from_cursor=0:0`
	 * and `cursor=0:0` start at genesis, subject to tier retention.
	 */
	cursor?: StreamsCursorInput;
	cursorRaw?: string;
	/**
	 * If neither `from_height` nor a cursor is provided, the handler sets this to
	 * `tip.block_height - STREAMS_BLOCKS_PER_DAY`. Explicit `from_height=0`
	 * is preserved and bypasses the default window.
	 */
	fromHeight?: number;
	toHeight: number;
	types?: readonly StreamsEventType[];
	contractId?: string;
	limit: number;
	cursorPastTip: boolean;
};

export type StreamsEventsResponse = {
	events: StreamsEvent[];
	next_cursor: string | null;
	tip: StreamsTip;
	reorgs: StreamsReorg[];
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

function parseTypes(
	value: string | undefined,
): readonly StreamsEventType[] | undefined {
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

function parseContractId(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError("contract_id must not be empty");
	}
	return value;
}

export function getClampedStreamsTipHeight(tip: StreamsTip): number {
	return Math.max(0, tip.block_height - tip.lag_seconds);
}

export function parseStreamsEventsQuery(
	query: URLSearchParams,
	tip: StreamsTip,
): StreamsEventsQuery {
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
	const defaultFromHeight =
		cursorRaw === undefined && fromHeightRaw === undefined
			? Math.max(0, tip.block_height - STREAMS_BLOCKS_PER_DAY)
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromHeight: fromHeight ?? defaultFromHeight,
		toHeight,
		types: parseTypes(query.get("types") ?? undefined),
		contractId: parseContractId(query.get("contract_id") ?? undefined),
		limit: parseLimit(query.get("limit") ?? undefined),
		cursorPastTip: cursor ? cursor.block_height > clampedTipHeight : false,
	};
}

export async function getStreamsEventsResponse(opts: {
	query: URLSearchParams;
	tip: StreamsTip;
	readEvents?: StreamsEventsReader;
	readReorgs?: StreamsReorgsReader;
}): Promise<StreamsEventsResponse> {
	const parsed = parseStreamsEventsQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			events: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			// reorgs stays empty until reorg detection lands; see PRD 0001 reorg endpoint task.
			reorgs: [],
		};
	}

	const readEvents = opts.readEvents ?? readCanonicalStreamsEvents;
	const result = await readEvents({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		types: parsed.types,
		contractId: parsed.contractId,
		limit: parsed.limit,
	});
	const readReorgs = opts.readReorgs ?? EMPTY_STREAMS_REORGS_READER;
	const firstEvent = result.events.at(0);
	const lastEvent = result.events.at(-1);
	const reorgs =
		firstEvent && lastEvent
			? await readReorgs({
					from: {
						block_height: firstEvent.block_height,
						event_index: firstEvent.event_index,
					},
					to: {
						block_height: lastEvent.block_height,
						event_index: lastEvent.event_index,
					},
				})
			: [];

	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
