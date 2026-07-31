import {
	type ReadCanonicalStreamsEventsParams,
	type ReadCanonicalStreamsEventsResult,
	STREAMS_EVENT_TYPES,
	type StreamsEvent,
	type StreamsEventType,
	type StreamsLabelledFilter,
	readCanonicalStreamsEvents,
} from "@secondlayer/indexer/streams-events";
import { ValidationError } from "@secondlayer/shared/errors";
import { parseCursor, parseNonNegativeInteger } from "../parse-query.ts";
import type { StreamsCursorInput } from "./cursor.ts";
import {
	EMPTY_STREAMS_REORGS_READER,
	type StreamsReorg,
	type StreamsReorgsReader,
} from "./reorgs.ts";
import {
	STREAMS_DEFAULT_FROM_HEIGHT_WINDOW_BLOCKS,
	STREAMS_TIP_REORG_MARGIN_BLOCKS,
} from "./tiers.ts";
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
	filters?: Readonly<Record<string, StreamsLabelledFilter>>;
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

/** `event_type=<single>` is accepted as an alias for `types` — the Index
 *  spelling, honored here as a courtesy (docs/internal/charter/
 *  index-vs-streams.md). One value only; a set must use `types`. */
function resolveTypesParam(query: URLSearchParams): string | undefined {
	const types = query.get("types") ?? undefined;
	const alias = query.get("event_type") ?? undefined;
	if (alias === undefined) return types;
	if (types !== undefined) {
		throw new ValidationError("types and event_type are mutually exclusive");
	}
	if (alias.includes(",")) {
		throw new ValidationError(
			"event_type takes one value — use types=a,b for a set",
		);
	}
	return alias;
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

const MAX_FILTER_LABELS = 8;
const FILTER_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const FILTER_GROUP_KEYS = new Set([
	"types",
	"contractId",
	"sender",
	"recipient",
	"assetIdentifier",
]);

/**
 * `filters` — a JSON-encoded map of labelled filter groups. Groups OR together
 * server-side and every returned event echoes the labels it satisfied, so two
 * unrelated concerns share one scan, one cursor, and one checkpoint instead of
 * two consume loops.
 *
 * JSON rather than repeated flat params because the value is nested (a label
 * owning its own type list and payload filters), and a query param keeps GET
 * semantics — so SSE `subscribe` takes it unchanged and no new POST-and-stream
 * route is needed.
 */
function parseFilters(
	value: string | undefined,
): Record<string, StreamsLabelledFilter> | undefined {
	if (value === undefined) return undefined;

	let decoded: unknown;
	try {
		decoded = JSON.parse(value);
	} catch {
		throw new ValidationError(
			"filters must be a JSON object of label → filter",
		);
	}
	if (
		decoded === null ||
		typeof decoded !== "object" ||
		Array.isArray(decoded)
	) {
		throw new ValidationError(
			"filters must be a JSON object of label → filter",
		);
	}

	const entries = Object.entries(decoded as Record<string, unknown>);
	if (entries.length === 0) {
		throw new ValidationError("filters must declare at least one label");
	}
	if (entries.length > MAX_FILTER_LABELS) {
		throw new ValidationError(
			`filters accepts at most ${MAX_FILTER_LABELS} labels`,
		);
	}

	const parsed: Record<string, StreamsLabelledFilter> = {};
	for (const [label, group] of entries) {
		if (!FILTER_LABEL_PATTERN.test(label)) {
			throw new ValidationError(
				`Invalid filter label "${label}": use letters, digits, - and _ (max 32)`,
			);
		}
		if (group === null || typeof group !== "object" || Array.isArray(group)) {
			throw new ValidationError(`filters.${label} must be an object`);
		}
		const record = group as Record<string, unknown>;
		const unknownKey = Object.keys(record).find(
			(key) => !FILTER_GROUP_KEYS.has(key),
		);
		if (unknownKey) {
			throw new ValidationError(
				`Unknown field in filters.${label}: ${unknownKey}`,
			);
		}
		parsed[label] = {
			types: parseTypes(
				joinFilterValue(record.types, `filters.${label}.types`),
			),
			contractId: parseListFilter(
				joinFilterValue(record.contractId, `filters.${label}.contractId`),
				`filters.${label}.contractId`,
			),
			sender: parseListFilter(
				joinFilterValue(record.sender, `filters.${label}.sender`),
				`filters.${label}.sender`,
			),
			recipient: parseListFilter(
				joinFilterValue(record.recipient, `filters.${label}.recipient`),
				`filters.${label}.recipient`,
			),
			assetIdentifier: parsePayloadFilter(
				joinFilterValue(
					record.assetIdentifier,
					`filters.${label}.assetIdentifier`,
				),
				`filters.${label}.assetIdentifier`,
			),
		};
	}
	return parsed;
}

/** Normalize a JSON string-or-array field into the comma form the flat
 *  query-param parsers already validate, so both wire shapes share one rule. */
function joinFilterValue(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return value;
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		if (value.length === 0)
			throw new ValidationError(`${name} must not be empty`);
		return value.join(",");
	}
	throw new ValidationError(`${name} must be a string or array of strings`);
}

/**
 * Highest height the public Streams API will serve. Held back from the raw tip
 * by a fixed reorg-safety margin (in blocks) so consumers never read a height
 * likely to reorg; the L2 decoder and SDK consumer rewind on reorg, so a small
 * margin suffices. The margin is a block count — NOT `lag_seconds`, which is a
 * wall-clock value and would hold the tip back ~lag_seconds blocks (the bug this
 * replaces). Override via `STREAMS_TIP_REORG_MARGIN_BLOCKS` for ops tuning.
 */
export function getClampedStreamsTipHeight(tip: StreamsTip): number {
	return Math.max(0, tip.block_height - reorgMarginBlocks());
}

function reorgMarginBlocks(): number {
	const raw = process.env.STREAMS_TIP_REORG_MARGIN_BLOCKS;
	if (raw == null || raw.trim() === "") return STREAMS_TIP_REORG_MARGIN_BLOCKS;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0
		? parsed
		: STREAMS_TIP_REORG_MARGIN_BLOCKS;
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
		types: parseTypes(resolveTypesParam(query)),
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
		filters: parseFilters(query.get("filters") ?? undefined),
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
		filters: parsed.filters,
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
