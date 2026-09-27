/**
 * Runes read surface — `/v1/index/runes/*` (plan 058, D15: Runes is more data
 * on the existing Index plane, not a new brand). Reads the separate Bitcoin/
 * Runes Postgres (`packages/bitcoin`, D18) through `../bitcoin/db.ts`, and
 * follows the newest Index family (`pox5-events.ts`) section by section:
 * FILTERS const, response row type, a reader with a `db?` seam, raw `sql`,
 * `LIMIT limit+1` keyset pagination, a `getXResponse` that owns cursor/window
 * parsing and the not-configured soft-flag.
 *
 * Four operations:
 *   - `listRunes`    — the rune catalog (search by name prefix, sort by etch
 *                       order or mint count).
 *   - `getRune`      — one rune's full entry, with computed `supply`.
 *   - `listRuneActivity`  — the etch/mint/transfer/burn event log
 *                            (`rune_events`), cursor `<height>:<event_index>`
 *                            like every other decoded-event feed.
 *   - `listRuneBalances`  — current per-outpoint balances (`rune_balances`),
 *                            looked up by address or outpoint.
 *
 * Every rune identity in a response is the same small bundle — `id`, `name`
 * (no spacers), `spaced_name`, `symbol`, `divisibility` — so a client
 * rendering an activity feed or a balance list never needs a second lookup
 * just to show a name (plan 058 decision).
 *
 * `listRunes`/`getRune` read a snapshot table (`rune_entries`) that ingest
 * already keeps reorg-correct — a rewind (`../../packages/bitcoin/src/rewind.ts`)
 * mutates entries/balances in place rather than leaving orphaned rows behind.
 * Their `reorgs` field is therefore always `[]`: there is no stale page to
 * reconcile, unlike an append-only event log. `listRuneActivity` is the one
 * operation that carries real reorg spans, the same way `pox5-events.ts` does.
 */
import type { Database as BitcoinDatabase } from "@secondlayer/bitcoin/db";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { sql } from "kysely";
import {
	type BitcoinIndexTip,
	type BtcReorg,
	type BtcReorgsReader,
	type RuneRef,
	getBitcoinDb,
	isBitcoinConfigured,
	parseRuneRef,
} from "../bitcoin/db.ts";
import {
	type IndexCursorInput,
	encodeIndexCursor,
	parseCursor,
	parseFilter,
	parseLimit,
	parseListFilter,
	parseNonNegativeInteger,
} from "./_shared.ts";

const RUNES_NOT_CONFIGURED_NOTE =
	"Runes data is not configured on this instance (BITCOIN_DATABASE_URL).";

/** Bitcoin blocks per day at the ~10 minute target cadence. Deliberately its
 *  own constant, not `../streams/tiers.ts`'s `STREAMS_BLOCKS_PER_DAY`
 *  (17,280) — that one is tuned to Stacks' ~5s post-Nakamoto block time, and
 *  reusing it here would default `listRuneActivity`'s window to roughly four
 *  months of Bitcoin blocks instead of one day. */
const BITCOIN_BLOCKS_PER_DAY = 144;

// ── Identity ─────────────────────────────────────────────────────────────

/** The rune identity bundle every response embeds (plan 058 decision) — a
 *  client never needs a second lookup to show a name next to an event or a
 *  balance. */
export type RuneRefSummary = {
	id: string;
	/** No spacers, uppercase — `rune_entries.name` (migration 0005). */
	name: string;
	/** As etched, spacers included (`•`) — `rune_entries.spaced_rune`. */
	spaced_name: string;
	symbol: string | null;
	divisibility: number;
};

/** `resolveRuneId` inverse-lookup row shape. */
type RuneEntryIdRow = { rune_id: string };

/** Resolve a `RuneRef` to its canonical `rune_id` for filtering
 *  `rune_events`/`rune_balances` (both key on `rune_id`, not the raw `rune`
 *  integer). An id-form ref needs no round trip — it already *is* the key,
 *  even if it turns out to match no row (the caller's query then just
 *  matches nothing, same as any other unknown filter value). A name-form ref
 *  needs one lookup; `undefined` means no rune has that name, so the caller
 *  should short-circuit to an empty page rather than run a query that can
 *  only ever match zero rows. */
async function resolveRuneId(
	ref: RuneRef,
	db: Kysely<BitcoinDatabase>,
): Promise<string | undefined> {
	if ("id" in ref) return ref.id;
	const row = await db
		.selectFrom("rune_entries")
		.select("rune_id")
		.where("rune", "=", ref.rune.toString())
		.executeTakeFirst();
	return (row as RuneEntryIdRow | undefined)?.rune_id;
}

// ── listRunes / getRune (rune_entries) ──────────────────────────────────

export const RUNES_LIST_FILTERS = [
	"search",
	"sort",
	"cursor",
	"limit",
] as const;

export type RunesListSort = "number" | "mints";

function parseRunesListSort(raw: string | null): RunesListSort {
	if (raw === null || raw === "number") return "number";
	if (raw === "mints") return "mints";
	throw new ValidationError('sort must be "number" or "mints"');
}

/** `search=` normalizes exactly like a `RuneRef` name: spacers and case are
 *  ignored, so `search=dog` and `search=DOG` prefix-match the same rows as
 *  `rune_entries.name` (itself spacer-stripped, migration 0005). */
function normalizeSearchTerm(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const normalized = raw.toUpperCase().replace(/[.\s•]/g, "");
	if (normalized.length === 0) {
		throw new ValidationError("search must not be empty");
	}
	return normalized;
}

/** Escapes a `LIKE` pattern's special characters. `name` is always pure
 *  A-Z (`runeFromString`'s alphabet), so a legitimate search never contains
 *  `%`/`_`/`\` — this only stops a caller-supplied one of those from being
 *  read as a wildcard instead of a literal. */
function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type RunesListCursor =
	| { sort: "number"; number: bigint }
	| { sort: "mints"; mints: bigint; number: bigint };

/** Opaque base64url envelope, tagged with the sort it was issued under (like
 *  `mempool.ts`'s cursor) — a cursor from `sort=mints` reused against
 *  `sort=number` would silently resume at the wrong position, so the tag
 *  turns that into a clear 400 instead. */
function encodeRunesListCursor(cursor: RunesListCursor): string {
	const payload =
		cursor.sort === "number"
			? `number:${cursor.number}`
			: `mints:${cursor.mints}:${cursor.number}`;
	return Buffer.from(payload).toString("base64url");
}

function parseRunesListCursor(
	raw: string,
	sort: RunesListSort,
): RunesListCursor {
	let decoded: string;
	try {
		decoded = Buffer.from(raw, "base64url").toString("utf8");
	} catch {
		throw new ValidationError("cursor is not a valid runes cursor");
	}
	const parts = decoded.split(":");
	if (parts[0] !== sort) {
		throw new ValidationError(
			`cursor was issued for sort=${parts[0]}, not sort=${sort}`,
		);
	}
	if (sort === "number") {
		const n = parts[1];
		if (n === undefined || !/^\d+$/.test(n)) {
			throw new ValidationError("cursor is not a valid runes cursor");
		}
		return { sort: "number", number: BigInt(n) };
	}
	const mints = parts[1];
	const number = parts[2];
	if (
		mints === undefined ||
		number === undefined ||
		!/^\d+$/.test(mints) ||
		!/^\d+$/.test(number)
	) {
		throw new ValidationError("cursor is not a valid runes cursor");
	}
	return { sort: "mints", mints: BigInt(mints), number: BigInt(number) };
}

/** Minted terms — absent (`null`) for a premine-only rune that was never
 *  mintable (`has_terms = false`, migration 0003's `RuneEntriesTable.has_terms`). */
export type RuneTerms = {
	amount: string | null;
	cap: string | null;
	height_start: string | null;
	height_end: string | null;
	offset_start: string | null;
	offset_end: string | null;
};

export type RuneEntry = RuneRefSummary & {
	/** Etch sequence number — 0 is the genesis-seeded reserved rune, then
	 *  assigned in etch order. Default list sort. */
	number: string;
	/** u128 decimal string. Never `Number()` — see plan rule. */
	premine: string;
	/** `premine + mints × terms.amount` (0 with no terms) — computed here, not
	 *  stored; `rune_entries` only carries the two multiplicands. */
	supply: string;
	burned: string;
	mints: string;
	turbo: boolean;
	etching_txid: string;
	etched_height: number;
	etched_tx_index: number;
	terms: RuneTerms | null;
};

export type RunesResponse = {
	runes: RuneEntry[];
	next_cursor: string | null;
	tip: BitcoinIndexTip;
	/** Always `[]` — see the module doc: `rune_entries` is a reorg-corrected
	 *  snapshot, not an append-only log. */
	reorgs: BtcReorg[];
	notes?: string;
};

export type RuneResponse = {
	rune: RuneEntry;
	tip: BitcoinIndexTip;
};

type RuneEntryDbRow = {
	rune_id: string;
	number: string;
	name: string;
	spaced_rune: string;
	symbol: string | null;
	divisibility: number;
	premine: string;
	terms_amount: string | null;
	terms_cap: string | null;
	terms_height_start: string | null;
	terms_height_end: string | null;
	terms_offset_start: string | null;
	terms_offset_end: string | null;
	has_terms: boolean;
	turbo: boolean;
	etching_txid: string;
	block: string | number;
	tx: string | number;
	mints: string;
	burned: string;
};

const RUNE_ENTRY_COLUMNS = sql`
	rune_id,
	number,
	name,
	spaced_rune,
	symbol,
	divisibility,
	premine,
	terms_amount,
	terms_cap,
	terms_height_start,
	terms_height_end,
	terms_offset_start,
	terms_offset_end,
	has_terms,
	turbo,
	etching_txid,
	block,
	tx,
	mints,
	burned`;

function normalizeRuneEntry(row: RuneEntryDbRow): RuneEntry {
	const termsAmount = row.terms_amount ?? "0";
	const supply = (
		BigInt(row.premine) +
		BigInt(row.mints) * BigInt(termsAmount)
	).toString();
	return {
		id: row.rune_id,
		number: row.number,
		name: row.name,
		spaced_name: row.spaced_rune,
		symbol: row.symbol,
		divisibility: row.divisibility,
		premine: row.premine,
		supply,
		burned: row.burned,
		mints: row.mints,
		turbo: row.turbo,
		etching_txid: row.etching_txid,
		etched_height: Number(row.block),
		etched_tx_index: Number(row.tx),
		terms: row.has_terms
			? {
					amount: row.terms_amount,
					cap: row.terms_cap,
					height_start: row.terms_height_start,
					height_end: row.terms_height_end,
					offset_start: row.terms_offset_start,
					offset_end: row.terms_offset_end,
				}
			: null,
	};
}

export type ReadRunesParams = {
	search?: string;
	sort: RunesListSort;
	after?: RunesListCursor;
	limit: number;
	db?: Kysely<BitcoinDatabase>;
};

export type ReadRunesResult = {
	runes: RuneEntry[];
	next_cursor: string | null;
};

export type RunesReader = (params: ReadRunesParams) => Promise<ReadRunesResult>;

export async function readRunes(
	params: ReadRunesParams,
): Promise<ReadRunesResult> {
	const db = params.db ?? getBitcoinDb();
	if (!db) return { runes: [], next_cursor: null };

	const predicates: RawBuilder<unknown>[] = [];
	if (params.search) {
		predicates.push(
			sql`name LIKE ${`${escapeLikePattern(params.search)}%`} ESCAPE '\\'`,
		);
	}
	if (params.after) {
		predicates.push(
			params.after.sort === "mints"
				? sql`(mints, number) < (${params.after.mints}, ${params.after.number})`
				: sql`number > ${params.after.number}`,
		);
	}
	const where = predicates.length
		? sql`WHERE ${sql.join(predicates, sql` AND `)}`
		: sql``;
	// `mints DESC, number DESC` — both descending so the keyset above stays a
	// single row-values comparison (`<`); `number DESC` is just a stable
	// tiebreak for runes with equal mint counts, not a meaningful order on its
	// own. `number ASC` (etch order) is the plain, unique default sort.
	const orderBy =
		params.sort === "mints"
			? sql`ORDER BY mints DESC, number DESC`
			: sql`ORDER BY number ASC`;

	const { rows } = await sql<RuneEntryDbRow>`
		SELECT ${RUNE_ENTRY_COLUMNS}
		FROM rune_entries
		${where}
		${orderBy}
		LIMIT ${params.limit + 1}
	`.execute(db);

	const page = rows.slice(0, params.limit);
	const last = page.at(-1);
	const runes = page.map(normalizeRuneEntry);
	const next_cursor = last
		? encodeRunesListCursor(
				params.sort === "mints"
					? {
							sort: "mints",
							mints: BigInt(last.mints),
							number: BigInt(last.number),
						}
					: { sort: "number", number: BigInt(last.number) },
			)
		: null;
	return { runes, next_cursor };
}

export type RuneReader = (
	ref: RuneRef,
	db?: Kysely<BitcoinDatabase>,
) => Promise<RuneEntry | null>;

export async function readRune(
	ref: RuneRef,
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<RuneEntry | null> {
	if (!db) return null;
	const predicate =
		"id" in ref ? sql`rune_id = ${ref.id}` : sql`rune = ${ref.rune.toString()}`;
	const { rows } = await sql<RuneEntryDbRow>`
		SELECT ${RUNE_ENTRY_COLUMNS}
		FROM rune_entries
		WHERE ${predicate}
		LIMIT 1
	`.execute(db);
	const row = rows[0];
	return row ? normalizeRuneEntry(row) : null;
}

export async function getRunesResponse(opts: {
	query: URLSearchParams;
	tip: BitcoinIndexTip;
	readRunes?: RunesReader;
	configured?: boolean;
}): Promise<RunesResponse> {
	// Parse/validate before the not-configured check (matches pox5-events.ts:
	// a soft-flagged feed still 400s on a bad request; only the DATA is empty).
	const sort = parseRunesListSort(opts.query.get("sort"));
	const search = normalizeSearchTerm(opts.query.get("search") ?? undefined);
	const cursorRaw = opts.query.get("cursor") ?? undefined;
	const after =
		cursorRaw !== undefined ? parseRunesListCursor(cursorRaw, sort) : undefined;
	const limit = parseLimit(opts.query.get("limit") ?? undefined);

	const configured = opts.configured ?? isBitcoinConfigured();
	if (!configured) {
		return {
			runes: [],
			next_cursor: null,
			tip: opts.tip,
			reorgs: [],
			notes: RUNES_NOT_CONFIGURED_NOTE,
		};
	}

	const reader = opts.readRunes ?? readRunes;
	const result = await reader({ search, sort, after, limit });
	return {
		runes: result.runes,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs: [],
	};
}

/** Discriminated so the route can tell "no such rune" from "Runes isn't
 *  configured on this instance" apart — both are a 404, but only the latter
 *  carries the soft-flag note (plan 058: `getRune` → 404 `NOT_FOUND` with the
 *  same note other endpoints put in `notes`, here in `details`). */
export type GetRuneResult =
	| { found: true; rune: RuneEntry; tip: BitcoinIndexTip }
	| { found: false; notes?: string };

export async function getRuneResponse(opts: {
	runeRef: RuneRef;
	tip: BitcoinIndexTip;
	readRune?: RuneReader;
	configured?: boolean;
}): Promise<GetRuneResult> {
	const configured = opts.configured ?? isBitcoinConfigured();
	if (!configured) {
		return { found: false, notes: RUNES_NOT_CONFIGURED_NOTE };
	}
	const reader = opts.readRune ?? readRune;
	const rune = await reader(opts.runeRef);
	if (!rune) return { found: false };
	return { found: true, rune, tip: opts.tip };
}

// ── listRuneActivity (rune_events) ──────────────────────────────────────

export const RUNE_ACTIVITY_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"rune",
	"address",
	"kind",
	"txid",
] as const;

export type RuneEventKind =
	| "rune_etch"
	| "rune_mint"
	| "rune_transfer"
	| "rune_burn";

type DbRuneEventKind = "etch" | "mint" | "transfer" | "burn";

const RUNE_EVENT_KIND_WIRE_TO_DB: Record<RuneEventKind, DbRuneEventKind> = {
	rune_etch: "etch",
	rune_mint: "mint",
	rune_transfer: "transfer",
	rune_burn: "burn",
};

const RUNE_EVENT_KIND_DB_TO_WIRE: Record<DbRuneEventKind, RuneEventKind> = {
	etch: "rune_etch",
	mint: "rune_mint",
	transfer: "rune_transfer",
	burn: "rune_burn",
};

/** Parses the `kind` list filter (up to all 4 values) and maps wire → DB
 *  vocabulary (plan 058: wire is `rune_etch|rune_mint|rune_transfer|rune_burn`,
 *  the `rune_events.kind` column is the shorter `etch|mint|transfer|burn`). */
function parseRuneEventKinds(
	raw: string | undefined,
): DbRuneEventKind[] | undefined {
	const wireKinds = parseListFilter(raw, "kind", 4);
	if (!wireKinds) return undefined;
	return wireKinds.map((k) => {
		const dbKind = RUNE_EVENT_KIND_WIRE_TO_DB[k as RuneEventKind];
		if (!dbKind) {
			throw new ValidationError(
				`unknown kind: ${k} (expected one of ${Object.keys(RUNE_EVENT_KIND_WIRE_TO_DB).join(", ")})`,
			);
		}
		return dbKind;
	});
}

export type RuneEvent = {
	cursor: string;
	block_height: number;
	tx_index: number;
	txid: string;
	event_index: number;
	kind: RuneEventKind;
	/** u128 decimal string. Never `Number()`. */
	amount: string;
	vout: number | null;
	/** The output's mainnet address; only ever set on a `transfer` event
	 *  (migration 0004). */
	address: string | null;
	rune: RuneRefSummary;
};

export type RuneActivityResponse = {
	events: RuneEvent[];
	next_cursor: string | null;
	tip: BitcoinIndexTip;
	reorgs: BtcReorg[];
	notes?: string;
};

type RuneEventDbRow = {
	block_height: string | number;
	tx_index: string | number;
	txid: string;
	event_index: string | number;
	kind: DbRuneEventKind;
	amount: string;
	vout: number | null;
	address: string | null;
	rune_id: string;
	name: string;
	spaced_rune: string;
	symbol: string | null;
	divisibility: number;
};

function normalizeRuneEvent(row: RuneEventDbRow): RuneEvent {
	const blockHeight = Number(row.block_height);
	const eventIndex = Number(row.event_index);
	return {
		cursor: encodeIndexCursor({
			block_height: blockHeight,
			event_index: eventIndex,
		}),
		block_height: blockHeight,
		tx_index: Number(row.tx_index),
		txid: row.txid,
		event_index: eventIndex,
		kind: RUNE_EVENT_KIND_DB_TO_WIRE[row.kind],
		amount: row.amount,
		vout: row.vout,
		address: row.address,
		rune: {
			id: row.rune_id,
			name: row.name,
			spaced_name: row.spaced_rune,
			symbol: row.symbol,
			divisibility: row.divisibility,
		},
	};
}

export type ReadRuneActivityParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	rune?: RuneRef;
	address?: string;
	kinds?: DbRuneEventKind[];
	txid?: string;
	db?: Kysely<BitcoinDatabase>;
};

export type ReadRuneActivityResult = {
	events: RuneEvent[];
	next_cursor: string | null;
};

export type RuneActivityReader = (
	params: ReadRuneActivityParams,
) => Promise<ReadRuneActivityResult>;

export async function readRuneActivity(
	params: ReadRuneActivityParams,
): Promise<ReadRuneActivityResult> {
	const db = params.db ?? getBitcoinDb();
	if (!db) return { events: [], next_cursor: null };
	if (params.toHeight < params.fromHeight) {
		return { events: [], next_cursor: null };
	}

	let runeId: string | undefined;
	if (params.rune) {
		runeId = await resolveRuneId(params.rune, db);
		if (!runeId) return { events: [], next_cursor: null };
	}

	const predicates: RawBuilder<unknown>[] = [
		sql`e.height >= ${params.fromHeight}`,
		sql`e.height <= ${params.toHeight}`,
	];
	if (runeId) predicates.push(sql`e.rune_id = ${runeId}`);
	if (params.address) predicates.push(sql`e.address = ${params.address}`);
	if (params.kinds) predicates.push(sql`e.kind = ANY(${params.kinds})`);
	if (params.txid) predicates.push(sql`e.txid = ${params.txid}`);
	if (params.after) {
		predicates.push(
			sql`(e.height, e.event_index) > (${params.after.block_height}, ${params.after.event_index})`,
		);
	}

	const { rows } = await sql<RuneEventDbRow>`
		SELECT
			e.height AS block_height,
			e.tx_index,
			e.txid,
			e.event_index,
			e.kind,
			e.amount,
			e.vout,
			e.address,
			re.rune_id,
			re.name,
			re.spaced_rune,
			re.symbol,
			re.divisibility
		FROM rune_events e
		JOIN rune_entries re ON re.rune_id = e.rune_id
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY e.height ASC, e.event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const page = rows.slice(0, params.limit);
	const lastRow = page.at(-1);
	const events = page.map(normalizeRuneEvent);
	return {
		events,
		next_cursor: lastRow
			? encodeIndexCursor({
					block_height: Number(lastRow.block_height),
					event_index: Number(lastRow.event_index),
				})
			: null,
	};
}

/** `readRuneActivity`'s base window/cursor parse — same shape and mutual-
 *  exclusivity rules as `_shared.ts`'s `parseIndexBaseQuery`, deliberately
 *  reimplemented rather than shared: that helper's no-cursor default window
 *  is `STREAMS_BLOCKS_PER_DAY` (17,280), tuned to Stacks' ~5s block time — at
 *  Bitcoin's ~10 minute cadence that would default to roughly four months of
 *  blocks instead of one day. */
function parseRuneActivityBaseQuery(
	query: URLSearchParams,
	tip: BitcoinIndexTip,
): {
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	cursorPastTip: boolean;
} {
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
			? Math.max(0, tip.block_height - BITCOIN_BLOCKS_PER_DAY)
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

async function readActivityReorgs(
	events: readonly { block_height: number }[],
	readReorgs: BtcReorgsReader,
): Promise<BtcReorg[]> {
	const first = events.at(0);
	const last = events.at(-1);
	if (!first || !last) return [];
	return readReorgs(first.block_height, last.block_height);
}

export async function getRuneActivityResponse(opts: {
	query: URLSearchParams;
	tip: BitcoinIndexTip;
	readRuneActivity?: RuneActivityReader;
	readReorgs?: BtcReorgsReader;
	configured?: boolean;
}): Promise<RuneActivityResponse> {
	// Parse/validate before the not-configured check — see getRunesResponse.
	const base = parseRuneActivityBaseQuery(opts.query, opts.tip);
	const runeRaw = opts.query.get("rune") ?? undefined;
	const rune = runeRaw !== undefined ? parseRuneRef(runeRaw) : undefined;
	const kinds = parseRuneEventKinds(opts.query.get("kind") ?? undefined);
	const address = parseFilter(
		opts.query.get("address") ?? undefined,
		"address",
	);
	const txid = parseFilter(opts.query.get("txid") ?? undefined, "txid");

	const configured = opts.configured ?? isBitcoinConfigured();
	if (!configured) {
		return {
			events: [],
			next_cursor: null,
			tip: opts.tip,
			reorgs: [],
			notes: RUNES_NOT_CONFIGURED_NOTE,
		};
	}

	if (base.cursorPastTip) {
		return {
			events: [],
			next_cursor: base.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const reader = opts.readRuneActivity ?? readRuneActivity;
	const result = await reader({
		after: base.cursor,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
		rune,
		address,
		kinds,
		txid,
	});

	const readReorgs = opts.readReorgs ?? (async () => []);
	const reorgs = await readActivityReorgs(result.events, readReorgs);
	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}

// ── listRuneBalances (rune_balances) ────────────────────────────────────

export const RUNE_BALANCES_FILTERS = [
	"limit",
	"cursor",
	"address",
	"outpoint",
	"rune",
] as const;

export type RuneBalance = {
	rune: RuneRefSummary;
	address: string | null;
	txid: string;
	vout: number;
	/** u128 decimal string. Never `Number()`. */
	amount: string;
};

export type RuneBalancesResponse = {
	balances: RuneBalance[];
	next_cursor: string | null;
	tip: BitcoinIndexTip;
	/** Always `[]` — see the module doc: balances are a reorg-corrected
	 *  snapshot, not an append-only log. */
	reorgs: BtcReorg[];
	notes?: string;
};

type RuneBalanceDbRow = {
	rune_id: string;
	txid: string;
	vout: number;
	amount: string;
	address: string | null;
	name: string;
	spaced_rune: string;
	symbol: string | null;
	divisibility: number;
};

function normalizeRuneBalance(row: RuneBalanceDbRow): RuneBalance {
	return {
		rune: {
			id: row.rune_id,
			name: row.name,
			spaced_name: row.spaced_rune,
			symbol: row.symbol,
			divisibility: row.divisibility,
		},
		address: row.address,
		txid: row.txid,
		vout: row.vout,
		amount: row.amount,
	};
}

type RuneBalanceCursor = { rune_id: string; txid: string; vout: number };

function encodeRuneBalanceCursor(cursor: RuneBalanceCursor): string {
	return Buffer.from(
		`${cursor.rune_id}|${cursor.txid}|${cursor.vout}`,
	).toString("base64url");
}

function parseRuneBalanceCursor(raw: string): RuneBalanceCursor {
	let decoded: string;
	try {
		decoded = Buffer.from(raw, "base64url").toString("utf8");
	} catch {
		throw new ValidationError("cursor is not a valid balances cursor");
	}
	const parts = decoded.split("|");
	const runeId = parts[0];
	const txid = parts[1];
	const voutRaw = parts[2];
	if (!runeId || !txid || voutRaw === undefined || !/^\d+$/.test(voutRaw)) {
		throw new ValidationError("cursor is not a valid balances cursor");
	}
	return { rune_id: runeId, txid, vout: Number(voutRaw) };
}

function parseOutpoint(raw: string): { txid: string; vout: number } {
	const idx = raw.lastIndexOf(":");
	if (idx === -1) throw new ValidationError("outpoint must be <txid>:<vout>");
	const txid = raw.slice(0, idx);
	const voutRaw = raw.slice(idx + 1);
	if (!txid || !/^\d+$/.test(voutRaw)) {
		throw new ValidationError("outpoint must be <txid>:<vout>");
	}
	return { txid, vout: Number(voutRaw) };
}

export type ReadRuneBalancesParams = {
	after?: RuneBalanceCursor;
	limit: number;
	address?: string;
	outpoint?: { txid: string; vout: number };
	rune?: RuneRef;
	db?: Kysely<BitcoinDatabase>;
};

export type ReadRuneBalancesResult = {
	balances: RuneBalance[];
	next_cursor: string | null;
};

export type RuneBalancesReader = (
	params: ReadRuneBalancesParams,
) => Promise<ReadRuneBalancesResult>;

export async function readRuneBalances(
	params: ReadRuneBalancesParams,
): Promise<ReadRuneBalancesResult> {
	const db = params.db ?? getBitcoinDb();
	if (!db) return { balances: [], next_cursor: null };

	let runeId: string | undefined;
	if (params.rune) {
		runeId = await resolveRuneId(params.rune, db);
		if (!runeId) return { balances: [], next_cursor: null };
	}

	const predicates: RawBuilder<unknown>[] = [];
	if (params.address) predicates.push(sql`b.address = ${params.address}`);
	if (params.outpoint) {
		predicates.push(sql`b.txid = ${params.outpoint.txid}`);
		predicates.push(sql`b.vout = ${params.outpoint.vout}`);
	}
	if (runeId) predicates.push(sql`b.rune_id = ${runeId}`);
	if (params.after) {
		predicates.push(
			sql`(b.rune_id, b.txid, b.vout) > (${params.after.rune_id}, ${params.after.txid}, ${params.after.vout})`,
		);
	}
	const where = predicates.length
		? sql`WHERE ${sql.join(predicates, sql` AND `)}`
		: sql``;

	const { rows } = await sql<RuneBalanceDbRow>`
		SELECT
			b.rune_id,
			b.txid,
			b.vout,
			b.amount,
			b.address,
			re.name,
			re.spaced_rune,
			re.symbol,
			re.divisibility
		FROM rune_balances b
		JOIN rune_entries re ON re.rune_id = b.rune_id
		${where}
		ORDER BY b.rune_id ASC, b.txid ASC, b.vout ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const page = rows.slice(0, params.limit);
	const last = page.at(-1);
	const balances = page.map(normalizeRuneBalance);
	const next_cursor = last
		? encodeRuneBalanceCursor({
				rune_id: last.rune_id,
				txid: last.txid,
				vout: last.vout,
			})
		: null;
	return { balances, next_cursor };
}

export async function getRuneBalancesResponse(opts: {
	query: URLSearchParams;
	tip: BitcoinIndexTip;
	readRuneBalances?: RuneBalancesReader;
	configured?: boolean;
}): Promise<RuneBalancesResponse> {
	// Parse/validate before the not-configured check — see getRunesResponse.
	const addressRaw = opts.query.get("address") ?? undefined;
	const outpointRaw = opts.query.get("outpoint") ?? undefined;
	if ((addressRaw === undefined) === (outpointRaw === undefined)) {
		throw new ValidationError("exactly one of address or outpoint is required");
	}
	const address =
		addressRaw !== undefined ? parseFilter(addressRaw, "address") : undefined;
	const outpoint =
		outpointRaw !== undefined ? parseOutpoint(outpointRaw) : undefined;
	const runeRaw = opts.query.get("rune") ?? undefined;
	const rune = runeRaw !== undefined ? parseRuneRef(runeRaw) : undefined;
	const cursorRaw = opts.query.get("cursor") ?? undefined;
	const after =
		cursorRaw !== undefined ? parseRuneBalanceCursor(cursorRaw) : undefined;
	const limit = parseLimit(opts.query.get("limit") ?? undefined);

	const configured = opts.configured ?? isBitcoinConfigured();
	if (!configured) {
		return {
			balances: [],
			next_cursor: null,
			tip: opts.tip,
			reorgs: [],
			notes: RUNES_NOT_CONFIGURED_NOTE,
		};
	}

	const reader = opts.readRuneBalances ?? readRuneBalances;
	const result = await reader({ after, limit, address, outpoint, rune });
	return {
		balances: result.balances,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs: [],
	};
}
