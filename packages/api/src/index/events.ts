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
	parseListFilter,
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
		// asset_identifier mirrors nft_transfer: the column is NOT NULL for every
		// ft row, and the unified filter union (`on.ftTransfer({ assetIdentifier })`)
		// projects it here — rejecting it broke the union's contract.
		equalityFilters: ["contract_id", "asset_identifier", "sender", "recipient"],
		allowedFilters: [...INDEX_COMMON_FILTERS, "asset_identifier"],
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
		equalityFilters: ["contract_id", "asset_identifier", "recipient"],
		allowedFilters: [
			...PAGINATION_FILTERS,
			"contract_id",
			"asset_identifier",
			"recipient",
		],
	},
	ft_burn: {
		columns: ["asset_identifier", "sender", "amount"],
		requiredNonNull: ["contract_id", "asset_identifier", "sender", "amount"],
		equalityFilters: ["contract_id", "asset_identifier", "sender"],
		allowedFilters: [
			...PAGINATION_FILTERS,
			"contract_id",
			"asset_identifier",
			"sender",
		],
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
	/** Submitting-transaction context, present only when `tx_context=true`. The
	 *  real tx sender — distinct from a transfer event's asset `sender`, and the
	 *  only place a print event's sender is available. Lets the subgraph runtime
	 *  build `ctx.tx` without fetching every transaction in the range. */
	tx_sender?: string | null;
	tx_type?: string | null;
	tx_status?: string | null;
	tx_contract_id?: string | null;
	tx_function_name?: string | null;
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
	tx_sender?: string | null;
	tx_type?: string | null;
	tx_status?: string | null;
	tx_contract_id?: string | null;
	tx_function_name?: string | null;
};

export type IndexEventsQuery = {
	eventType: IndexEventType;
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	filters: Partial<Record<IndexEqualityFilter, string>>;
	/** Set only when `contract_id` carried more than one value. */
	contractIds?: string[];
	/** Restrict to contracts conforming to this trait/standard (resolved as-of toHeight). */
	trait?: string;
	/** Join the submitting tx for `tx_*` fields (opt-in; powers subgraph reindex). */
	withTx: boolean;
	/** Return only these columns (see `ReadIndexEventsParams.fields`). */
	fields?: readonly string[];
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
	/** Scope to several contracts at once. Set only when the caller passed more
	 *  than one `contract_id`; a single id stays in `filters` so it keeps the
	 *  contract-led ORDER BY. See the ordering note in the reader. */
	contractIds?: readonly string[];
	/** Restrict to contracts conforming to this trait/standard (resolved as-of toHeight). */
	trait?: string;
	/** Join the submitting tx for `tx_*` fields (opt-in; powers subgraph reindex). */
	withTx?: boolean;
	/**
	 * Return only these columns. Validated against the event type's own
	 * vocabulary by the query parser.
	 *
	 * `cursor`, `block_height`, and `event_type` are always returned: the first
	 * two are the consume contract and the third carries the discriminant, so
	 * omitting them is not expressible. `block_height` and `event_index` also
	 * stay in the SQL SELECT unconditionally — cursor encoding and the
	 * reorg-span lookup read them — and are stripped from the response instead.
	 *
	 * This does NOT change your bill: Index meters per row read, not per
	 * field. What it buys is wire bytes, and — when `block_time` is omitted —
	 * skipping the `blocks` join entirely.
	 */
	fields?: readonly string[];
	db?: Kysely<Database>;
};

export type ReadIndexEventsResult = {
	events: IndexEvent[];
	next_cursor: string | null;
	/**
	 * First/last `(block_height, event_index)` of the page, captured BEFORE
	 * the field projection strips them. The reorg-span lookup needs both, and
	 * `event_index` is droppable from the response — so the span travels
	 * separately rather than being re-read off projected rows.
	 */
	span?: {
		from: { block_height: number; event_index: number };
		to: { block_height: number; event_index: number };
	};
};

export type IndexEventsReader = (
	params: ReadIndexEventsParams,
) => Promise<ReadIndexEventsResult>;

/** Response fields that survive any projection. */
const ALWAYS_FIELDS = new Set(["cursor", "block_height", "event_type"]);

function normalizeIndexRow(
	row: IndexEventRow,
	config: IndexEventConfig,
	fields?: ReadonlySet<string>,
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
	if (fields) {
		// Strip what the caller didn't ask for. `block_height`/`event_index`
		// were selected regardless (cursor + reorg span need them), so the
		// projection happens HERE rather than in the SELECT list.
		for (const key of Object.keys(event)) {
			if (!ALWAYS_FIELDS.has(key) && !fields.has(key)) {
				delete (event as Record<string, unknown>)[key];
			}
		}
	}
	// Submitting-tx context (present only when the read joined it).
	if (row.tx_sender !== undefined) {
		event.tx_sender = row.tx_sender;
		event.tx_type = row.tx_type;
		event.tx_status = row.tx_status;
		event.tx_contract_id = row.tx_contract_id;
		event.tx_function_name = row.tx_function_name;
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
		sql`decoded_events.canonical = true`,
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

	// Multi-contract scope. Deliberately NOT routed through `filters`, which
	// would make `contract_id` the lead ORDER BY column (see below): sorting by
	// contract first while the keyset compares only (block_height, event_index)
	// silently drops every row of a later contract that sits below the cursor's
	// height. Same shape as the trait scope, for the same reason.
	if (params.contractIds && params.contractIds.length > 0) {
		predicates.push(
			sql`contract_id IN (${sql.join(
				params.contractIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}

	// Trait scope: resolve "all contracts of standard X (as-of toHeight)" to a
	// contract-id set and filter on it. No matches → empty page (skip the read).
	if (params.trait) {
		const ids = await resolveTraitContractIds(
			db,
			params.trait,
			params.toHeight,
		);
		if (ids.length === 0) return { events: [], next_cursor: null };
		predicates.push(
			sql`contract_id IN (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);
	}

	// A scalar equality filter can lead the sort for free — it's a constant, so
	// `col ASC, block_height ASC, event_index ASC` matches the composite index
	// and the (block_height, event_index) keyset still totally orders the page.
	// That stops being true the moment the column takes more than one value,
	// which is why the multi-contract and trait scopes never populate `filters`.
	const leadFilter = config.equalityFilters.find((filter) => filters[filter]);
	const orderBy = leadFilter
		? sql`${sql.ref(leadFilter)} ASC, block_height ASC, event_index ASC`
		: sql`block_height ASC, event_index ASC`;
	// Projection: select only the type-specific columns the caller asked for.
	// The universal columns below are handled separately — `block_height` and
	// `event_index` are always selected (cursor encoding + reorg-span lookup
	// read them) and stripped from the response instead.
	const wanted = params.fields ? new Set(params.fields) : undefined;
	const selectedColumns = wanted
		? config.columns.filter((column) => wanted.has(column))
		: [...config.columns];
	const extraColumns =
		selectedColumns.length > 0
			? sql`, ${sql.join(
					selectedColumns.map((column) => sql.ref(column)),
					sql`, `,
				)}`
			: sql``;
	// `block_time` is not a column of decoded_events — it is `to_timestamp()`
	// off a LEFT JOIN on blocks, on EVERY read. Omitting it lets the planner
	// skip that join entirely, which is the real win here.
	const needsBlockTime = !wanted || wanted.has("block_time");
	const blockTimeSelect = needsBlockTime
		? sql`, to_timestamp(b.timestamp) AT TIME ZONE 'UTC' AS block_time`
		: sql``;
	const blocksJoin = needsBlockTime
		? sql`LEFT JOIN blocks b
			ON b.height = decoded_events.block_height
			AND b.canonical = true`
		: sql``;
	// Universal columns other than the always-present ones.
	const optionalBase = ["tx_id", "tx_index", "contract_id"] as const;
	const baseSelect = sql.join(
		optionalBase
			.filter((column) => !wanted || wanted.has(column))
			.map((column) => sql.ref(column)),
		sql`, `,
	);
	const baseSelectClause =
		optionalBase.filter((c) => !wanted || wanted.has(c)).length > 0
			? sql`, ${baseSelect}`
			: sql``;

	// Opt-in submitting-tx context. A LATERAL lookup on the canonical (tx_id,
	// block_height) — one PK-indexed probe per row, only when requested — so the
	// subgraph reindex stops fetching every transaction in the range (the ~37x
	// over-fetch; see docs/sprints/indexing-speed/plan.md T2). The derived columns
	// are aliased to `tx_*` INSIDE the subquery, so the `tx` table exposes no bare
	// `contract_id`/`sender`/etc. that would collide with decoded_events' own
	// columns — the outer bare-column references (SELECT contract_id, WHERE
	// contract_id IN …) stay unambiguously scoped to decoded_events.
	const txSelect = params.withTx
		? sql`, tx.tx_sender, tx.tx_type, tx.tx_status, tx.tx_contract_id, tx.tx_function_name`
		: sql``;
	const txJoin = params.withTx
		? sql`LEFT JOIN LATERAL (
				SELECT t.sender AS tx_sender, t.type AS tx_type, t.status AS tx_status, t.contract_id AS tx_contract_id, t.function_name AS tx_function_name
				FROM transactions t
				WHERE t.tx_id = decoded_events.tx_id
					AND t.block_height = decoded_events.block_height
				LIMIT 1
			) tx ON true`
		: sql``;

	const { rows } = await sql<IndexEventRow>`
		SELECT
			cursor,
			block_height,
			event_index,
			event_type${blockTimeSelect}${baseSelectClause}${extraColumns}${txSelect}
		FROM decoded_events
		${blocksJoin}
		${txJoin}
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY ${orderBy}
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	// Capture the span from the RAW rows: block_height/event_index are always
	// selected, but the projection may strip event_index from the response.
	const firstRow = pageRows.at(0);
	const lastRow = pageRows.at(-1);
	const span =
		firstRow && lastRow
			? {
					from: {
						block_height: Number(firstRow.block_height),
						event_index: Number(firstRow.event_index),
					},
					to: {
						block_height: Number(lastRow.block_height),
						event_index: Number(lastRow.event_index),
					},
				}
			: undefined;
	const events = pageRows.map((row) => normalizeIndexRow(row, config, wanted));
	const lastEvent = lastRow;

	return {
		events,
		next_cursor: lastEvent
			? encodeIndexCursor({
					block_height: Number(lastEvent.block_height),
					event_index: Number(lastEvent.event_index),
				})
			: null,
		span,
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
		"tx_context",
		"fields",
		...(traitSupported ? ["trait"] : []),
	]);

	const base = parseIndexBaseQuery(query, tip);
	const filters: Partial<Record<IndexEqualityFilter, string>> = {};
	let contractIds: string[] | undefined;
	for (const filter of config.equalityFilters) {
		if (filter === "contract_id") {
			// One id keeps the scalar path (and its contract-led ORDER BY); several
			// become an IN scope that must stay out of `filters`.
			const ids = parseListFilter(query.get(filter) ?? undefined, filter);
			if (ids === undefined) continue;
			if (ids.length === 1) filters.contract_id = ids[0];
			else contractIds = ids;
			continue;
		}
		const value = parseFilter(query.get(filter) ?? undefined, filter);
		if (value !== undefined) filters[filter] = value;
	}

	const trait = parseFilter(query.get("trait") ?? undefined, "trait");
	if (trait !== undefined) {
		if (!traitSupported) {
			throw new ValidationError(
				`trait filter is not supported for ${eventTypeRaw}`,
			);
		}
		if (filters.contract_id !== undefined || contractIds !== undefined) {
			throw new ValidationError("trait and contract_id are mutually exclusive");
		}
	}

	const withTx = query.get("tx_context") === "true";
	const fields = parseFieldsParam(query.get("fields"), config, withTx);
	return {
		...base,
		eventType: eventTypeRaw,
		filters,
		contractIds,
		trait,
		withTx,
		fields,
	};
}

/** Universal columns every decoded event carries. */
const UNIVERSAL_FIELDS = [
	"cursor",
	"block_height",
	"block_time",
	"tx_id",
	"tx_index",
	"event_index",
	"event_type",
	"contract_id",
] as const;
/** Only meaningful alongside `tx_context=true`. */
const TX_CONTEXT_FIELDS = [
	"tx_sender",
	"tx_type",
	"tx_status",
	"tx_contract_id",
	"tx_function_name",
] as const;

/**
 * Parse and validate `fields`. Unknown names are refused (rather than
 * silently ignored) so a typo can't quietly drop a column the caller
 * believes they requested.
 */
function parseFieldsParam(
	raw: string | null,
	config: IndexEventConfig,
	withTx: boolean,
): readonly string[] | undefined {
	if (raw === null) return undefined;
	const requested = raw
		.split(",")
		.map((f) => f.trim())
		.filter(Boolean);
	if (requested.length === 0) {
		throw new ValidationError("fields must name at least one column");
	}
	const allowed = new Set<string>([
		...UNIVERSAL_FIELDS,
		...config.columns,
		...(withTx ? TX_CONTEXT_FIELDS : []),
	]);
	for (const field of requested) {
		if (!allowed.has(field)) {
			throw new ValidationError(
				`unknown field: ${field} (available for this event_type: ${[...allowed].sort().join(", ")})`,
			);
		}
	}
	return requested;
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
		contractIds: parsed.contractIds,
		trait: parsed.trait,
		withTx: parsed.withTx,
		fields: parsed.fields,
	});
	// Prefer the raw span (survives a projection that dropped event_index).
	const reorgs = await readReorgsForEvents(
		result.span ? [result.span.from, result.span.to] : result.events,
		opts.readReorgs,
	);

	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}
