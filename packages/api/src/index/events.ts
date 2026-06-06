import { getSourceDb, sql } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { validateQueryParams } from "../middleware/validation.ts";
import type { StreamsReorg, StreamsReorgsReader } from "../streams/reorgs.ts";
import {
	type IndexCursorInput,
	encodeIndexCursor,
	parseFilter,
	parseIndexBaseQuery,
	readReorgsForEvents,
	toIsoOrNull,
} from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

/** Pagination/window params every Index read endpoint accepts. */
const PAGINATION_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
] as const;

/** Pagination plus the principal/contract filters the transfer types expose. */
const INDEX_COMMON_FILTERS = [
	...PAGINATION_FILTERS,
	"contract_id",
	"sender",
	"recipient",
] as const;

/** Equality filters a decoded-event type may expose. Each also drives the
 *  ORDER BY (the first provided filter, in config order, leads the sort). */
type IndexEqualityFilter =
	| "contract_id"
	| "asset_identifier"
	| "sender"
	| "recipient";

type IndexEventConfig = {
	/** Type-specific columns selected beyond the universal base, in SELECT order. */
	columns: readonly string[];
	/** Columns constrained to NOT NULL — the rows this event type guarantees. */
	requiredNonNull: readonly string[];
	/** Equality filters in ORDER BY precedence order. */
	equalityFilters: readonly IndexEqualityFilter[];
	/** Allowed query params (event_type is always allowed on /events). */
	allowedFilters: readonly string[];
};

/** Registry of decoded-event types served by GET /v1/index/events.
 *  New Streams-sourced event types (stx_transfer, mints/burns, print) plug in
 *  here — no new handler files. contract_call is tx-sourced and lives on its
 *  own endpoint, so it is intentionally absent. */
export const INDEX_EVENT_CONFIG = {
	ft_transfer: {
		columns: ["asset_identifier", "sender", "recipient", "amount"],
		requiredNonNull: [
			"contract_id",
			"asset_identifier",
			"sender",
			"recipient",
			"amount",
		],
		equalityFilters: ["contract_id", "sender", "recipient"],
		allowedFilters: INDEX_COMMON_FILTERS,
	},
	nft_transfer: {
		columns: ["asset_identifier", "sender", "recipient", "value"],
		requiredNonNull: [
			"contract_id",
			"asset_identifier",
			"sender",
			"recipient",
			"value",
		],
		equalityFilters: ["contract_id", "asset_identifier", "sender", "recipient"],
		allowedFilters: [...INDEX_COMMON_FILTERS, "asset_identifier"],
	},
	stx_transfer: {
		columns: ["sender", "recipient", "amount", "memo"],
		requiredNonNull: ["sender", "recipient", "amount"],
		equalityFilters: ["sender", "recipient"],
		allowedFilters: [...PAGINATION_FILTERS, "sender", "recipient"],
	},
	stx_mint: {
		columns: ["recipient", "amount"],
		requiredNonNull: ["recipient", "amount"],
		equalityFilters: ["recipient"],
		allowedFilters: [...PAGINATION_FILTERS, "recipient"],
	},
	stx_burn: {
		columns: ["sender", "amount"],
		requiredNonNull: ["sender", "amount"],
		equalityFilters: ["sender"],
		allowedFilters: [...PAGINATION_FILTERS, "sender"],
	},
	stx_lock: {
		// locked_address → sender, locked_amount → amount; unlock_height rides in
		// the jsonb payload ({ unlock_height }).
		columns: ["sender", "amount", "payload"],
		requiredNonNull: ["sender", "amount"],
		equalityFilters: ["sender"],
		allowedFilters: [...PAGINATION_FILTERS, "sender"],
	},
	ft_mint: {
		columns: ["asset_identifier", "recipient", "amount"],
		requiredNonNull: ["contract_id", "asset_identifier", "recipient", "amount"],
		equalityFilters: ["contract_id", "recipient"],
		allowedFilters: [...PAGINATION_FILTERS, "contract_id", "recipient"],
	},
	ft_burn: {
		columns: ["asset_identifier", "sender", "amount"],
		requiredNonNull: ["contract_id", "asset_identifier", "sender", "amount"],
		equalityFilters: ["contract_id", "sender"],
		allowedFilters: [...PAGINATION_FILTERS, "contract_id", "sender"],
	},
	nft_mint: {
		columns: ["asset_identifier", "recipient", "value"],
		requiredNonNull: ["contract_id", "asset_identifier", "recipient", "value"],
		equalityFilters: ["contract_id", "asset_identifier", "recipient"],
		allowedFilters: [
			...PAGINATION_FILTERS,
			"contract_id",
			"asset_identifier",
			"recipient",
		],
	},
	nft_burn: {
		columns: ["asset_identifier", "sender", "value"],
		requiredNonNull: ["contract_id", "asset_identifier", "sender", "value"],
		equalityFilters: ["contract_id", "asset_identifier", "sender"],
		allowedFilters: [
			...PAGINATION_FILTERS,
			"contract_id",
			"asset_identifier",
			"sender",
		],
	},
	print: {
		columns: ["payload"],
		requiredNonNull: ["contract_id"],
		equalityFilters: ["contract_id"],
		allowedFilters: [...PAGINATION_FILTERS, "contract_id"],
	},
} as const satisfies Record<string, IndexEventConfig>;

export type IndexEventType = keyof typeof INDEX_EVENT_CONFIG;

export const INDEX_EVENT_TYPES = Object.keys(
	INDEX_EVENT_CONFIG,
) as IndexEventType[];

export function isIndexEventType(value: string): value is IndexEventType {
	return value in INDEX_EVENT_CONFIG;
}

/** A decoded event in flat form, discriminated by `event_type`. Type-specific
 *  fields are optional at the type level; the per-type NOT NULL constraints
 *  guarantee their presence for the rows a given event_type returns. */
export type IndexEvent = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: IndexEventType;
	contract_id: string | null;
	asset_identifier?: string | null;
	sender?: string | null;
	recipient?: string | null;
	amount?: string | null;
	value?: string | null;
	memo?: string | null;
	payload?: unknown;
};

type IndexEventRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string | null;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	event_type: IndexEventType;
	contract_id: string | null;
	asset_identifier?: string | null;
	sender?: string | null;
	recipient?: string | null;
	amount?: string | null;
	value?: string | null;
	memo?: string | null;
	payload?: unknown;
};

export type IndexEventsQuery = {
	eventType: IndexEventType;
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	filters: Partial<Record<IndexEqualityFilter, string>>;
	/** Restrict to contracts conforming to this trait/standard (resolved as-of toHeight). */
	trait?: string;
	cursorPastTip: boolean;
};

export type IndexEventsResponse = {
	events: IndexEvent[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
};

export type ReadIndexEventsParams = {
	eventType: IndexEventType;
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	filters?: Partial<Record<IndexEqualityFilter, string>>;
	/** Restrict to contracts conforming to this trait/standard (resolved as-of toHeight). */
	trait?: string;
	db?: Kysely<Database>;
};

export type ReadIndexEventsResult = {
	events: IndexEvent[];
	next_cursor: string | null;
};

export type IndexEventsReader = (
	params: ReadIndexEventsParams,
) => Promise<ReadIndexEventsResult>;

function normalizeIndexRow(
	row: IndexEventRow,
	config: IndexEventConfig,
): IndexEvent {
	const event: IndexEvent = {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		event_type: row.event_type,
		contract_id: row.contract_id,
	};
	for (const column of config.columns) {
		const raw = (row as Record<string, unknown>)[column];
		// jsonb columns (print's payload) arrive as objects from postgres.js, but
		// parse defensively in case a driver hands back the raw string.
		(event as Record<string, unknown>)[column] =
			column === "payload" && typeof raw === "string"
				? parseJsonColumn(raw)
				: raw;
	}
	return event;
}

function parseJsonColumn(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/** Single SQL source for every decoded-event read. ft/nft transfer endpoints
 *  delegate here, so /events and the typed aliases never diverge. Column names
 *  come from the static registry, never from user input. */
export async function readIndexEvents(
	params: ReadIndexEventsParams,
): Promise<ReadIndexEventsResult> {
	if (params.toHeight < params.fromHeight) {
		return { events: [], next_cursor: null };
	}

	const config = INDEX_EVENT_CONFIG[params.eventType];
	const db = params.db ?? getSourceDb();
	const filters = params.filters ?? {};

	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`event_type = ${params.eventType}`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
		...config.requiredNonNull.map(
			(column) => sql`${sql.ref(column)} IS NOT NULL`,
		),
	];

	if (params.after) {
		// Sargable row-values keyset — lets Postgres range-scan the composite
		// (event_type, block_height, event_index) index. The equivalent OR form
		// (`bh > X OR (bh = X AND ei > Y)`) is non-sargable: the planner falls
		// back to bitmap-ANDing the bare event_type index, re-scanning the whole
		// event-type partition on every page (O(n²) pagination over print).
		predicates.push(
			sql`(block_height, event_index) > (${params.after.block_height}, ${params.after.event_index})`,
		);
	}

	for (const filter of config.equalityFilters) {
		const value = filters[filter];
		if (value) {
			predicates.push(sql`${sql.ref(filter)} = ${value}`);
		}
	}

	// Trait scope: resolve "all contracts of standard X (as-of toHeight)" to a
	// contract-id set and filter on it. No matches → empty page (skip the read).
	if (params.trait) {
		const ids = await resolveTraitContractIds(db, params.trait, params.toHeight);
		if (ids.length === 0) return { events: [], next_cursor: null };
		predicates.push(
			sql`contract_id IN (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}

	const leadFilter = config.equalityFilters.find((filter) => filters[filter]);
	const orderBy = leadFilter
		? sql`${sql.ref(leadFilter)} ASC, block_height ASC, event_index ASC`
		: sql`block_height ASC, event_index ASC`;
	const extraColumns = sql.join(
		config.columns.map((column) => sql.ref(column)),
		sql`, `,
	);

	const { rows } = await sql<IndexEventRow>`
		SELECT
			cursor,
			block_height,
			(
				SELECT to_timestamp(b.timestamp) AT TIME ZONE 'UTC'
				FROM blocks b
				WHERE b.height = decoded_events.block_height
					AND b.canonical = true
				LIMIT 1
			) AS block_time,
			tx_id,
			tx_index,
			event_index,
			event_type,
			contract_id,
			${extraColumns}
		FROM decoded_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY ${orderBy}
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map((row) => normalizeIndexRow(row, config));
	const lastEvent = events.at(-1);

	return {
		events,
		next_cursor: lastEvent
			? encodeIndexCursor({
					block_height: lastEvent.block_height,
					event_index: lastEvent.event_index,
				})
			: null,
	};
}

export function parseIndexEventsQuery(
	query: URLSearchParams,
	tip: IndexTip,
): IndexEventsQuery {
	const eventTypeRaw = query.get("event_type") ?? undefined;
	if (eventTypeRaw === undefined) {
		throw new ValidationError(
			`event_type is required (one of: ${INDEX_EVENT_TYPES.join(", ")})`,
		);
	}
	if (!isIndexEventType(eventTypeRaw)) {
		throw new ValidationError(
			`unknown event_type: ${eventTypeRaw} (one of: ${INDEX_EVENT_TYPES.join(", ")})`,
		);
	}

	const config = INDEX_EVENT_CONFIG[eventTypeRaw];
	// Trait scoping applies only to event types keyed by a contract (those with a
	// contract_id equality filter) — not the STX events.
	const traitSupported = (config.equalityFilters as readonly string[]).includes(
		"contract_id",
	);
	validateQueryParams(query, [
		...config.allowedFilters,
		"event_type",
		...(traitSupported ? ["trait"] : []),
	]);

	const base = parseIndexBaseQuery(query, tip);
	const filters: Partial<Record<IndexEqualityFilter, string>> = {};
	for (const filter of config.equalityFilters) {
		const value = parseFilter(query.get(filter) ?? undefined, filter);
		if (value !== undefined) filters[filter] = value;
	}

	const trait = parseFilter(query.get("trait") ?? undefined, "trait");
	if (trait !== undefined) {
		if (!traitSupported) {
			throw new ValidationError(`trait filter is not supported for ${eventTypeRaw}`);
		}
		if (filters.contract_id !== undefined) {
			throw new ValidationError("trait and contract_id are mutually exclusive");
		}
	}

	return { ...base, eventType: eventTypeRaw, filters, trait };
}

export async function getIndexEventsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readEvents?: IndexEventsReader;
	readReorgs?: StreamsReorgsReader;
}): Promise<IndexEventsResponse> {
	const parsed = parseIndexEventsQuery(opts.query, opts.tip);

	if (parsed.cursorPastTip) {
		return {
			events: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const readEvents = opts.readEvents ?? readIndexEvents;
	const result = await readEvents({
		eventType: parsed.eventType,
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		limit: parsed.limit,
		filters: parsed.filters,
		trait: parsed.trait,
	});
	const reorgs = await readReorgsForEvents(result.events, opts.readReorgs);

	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
