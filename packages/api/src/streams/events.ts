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
import { STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS } from "./tiers.ts";
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
	 * `tip.block_height - STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS`. Explicit
	 * `from_height=0` is preserved and bypasses the default window.
	 */
	fromHeight?: number;
	toHeight: number;
	types?: readonly StreamsEventType[];
	notTypes?: readonly StreamsEventType[];
	contractId?: string | string[];
	sender?: string | string[];
	recipient?: string | string[];
	assetIdentifier?: string;
	limit: number;
	cursorPastTip: boolean;
};

/**
 * Wire event: the indexer event plus `finalized`, true when the event's block
 * is at or below the tip's burn-confirmation finality boundary (immutable).
 */
export type StreamsEventEnvelope = StreamsEvent & { finalized: boolean };

export type StreamsEventsResponse = {
	events: StreamsEventEnvelope[];
	next_cursor: string | null;
	tip: StreamsTip;
	reorgs: StreamsReorg[];
};

export function markFinalized(
	events: readonly StreamsEvent[],
	finalizedHeight: number,
): StreamsEventEnvelope[] {
	return events.map((event) => ({
		...event,
		finalized: event.block_height <= finalizedHeight,
	}));
}

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
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new ValidationError("limit must be a positive integer");
	}
	return Math.min(1000, parsed);
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

/** Parse a single-or-comma-list filter. Returns a string for one value and a
 *  string[] for many, so single-value callers keep the simpler shape. */
function parseListFilter(
	value: string | undefined,
	name: string,
): string | string[] | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
	}
	const items = value.split(",").map((part) => part.trim());
	if (items.some((item) => item.length === 0)) {
		throw new ValidationError(`${name} must be a comma-separated list`);
	}
	return items.length === 1 ? items[0] : items;
}

function parsePayloadFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
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
			? Math.max(
					0,
					tip.block_height - STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS,
				)
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromHeight: fromHeight ?? defaultFromHeight,
		toHeight,
		types: parseTypes(query.get("types") ?? undefined),
		notTypes: parseTypes(query.get("not_types") ?? undefined),
		contractId: parseListFilter(
			query.get("contract_id") ?? undefined,
			"contract_id",
		),
		sender: parseListFilter(query.get("sender") ?? undefined, "sender"),
		recipient: parseListFilter(
			query.get("recipient") ?? undefined,
			"recipient",
		),
		assetIdentifier: parsePayloadFilter(
			query.get("asset_identifier") ?? undefined,
			"asset_identifier",
		),
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
		notTypes: parsed.notTypes,
		contractId: parsed.contractId,
		sender: parsed.sender,
		recipient: parsed.recipient,
		assetIdentifier: parsed.assetIdentifier,
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
		events: markFinalized(result.events, opts.tip.finalized_height),
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
