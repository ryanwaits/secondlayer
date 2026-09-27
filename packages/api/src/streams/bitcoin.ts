/**
 * `chain=bitcoin` Streams reads (plan 059) — Runes events served alongside
 * the Stacks feed, filtered by the request's `chain` param rather than a
 * second product. Reuses 058's Bitcoin DB module (`../bitcoin/db.ts`) for the
 * connection, `isBitcoinConfigured`, `parseRuneRef`, and `readBtcReorgs`; this
 * file owns the Streams-shaped keyset reader over `rune_events` and the
 * chain=bitcoin query parsing that mirrors `./events.ts`.
 *
 * Not configured (no `BITCOIN_DATABASE_URL`): readers return an empty page —
 * same soft-flag posture as 058, but Streams has no `notes` field in its
 * envelope, so an empty page is the whole signal (a self-hosted instance that
 * never provisions Bitcoin simply never sees `rune_*` events).
 */
import type { Database as BitcoinDatabase } from "@secondlayer/bitcoin/db";
import { CHECKPOINT_NAME } from "@secondlayer/bitcoin/db";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	RUNE_EVENT_TYPES,
	type RuneEtchEntry,
	type RuneEventPayload,
	type RuneEventType,
	type RuneStreamsEvent,
} from "@secondlayer/shared/streams-rows";
import type { Kysely, RawBuilder } from "kysely";
import { sql } from "kysely";
import {
	type RuneRef,
	getBitcoinDb,
	parseRuneRef,
	readBtcReorgs,
} from "../bitcoin/db.ts";
import { parseCursor, parseNonNegativeInteger } from "../parse-query.ts";
import type { StreamsCursorInput } from "./cursor.ts";
import { encodeStreamsCursor } from "./cursor.ts";
import type { StreamsReorg, StreamsReorgsReader } from "./reorgs.ts";

// Bitcoin blocks per day at the ~10 minute target cadence — see
// `../index/runes.ts`'s `BITCOIN_BLOCKS_PER_DAY` doc comment for why this is
// its own constant rather than reusing `./tiers.ts`'s Stacks-tuned one.
const BITCOIN_BLOCKS_PER_DAY = 144;

/** Mirrors `../bitcoin/db.ts`'s private `BITCOIN_FINALITY_CONFIRMATIONS` —
 *  the ingest side's `UNDO_DEPTH` (`@secondlayer/bitcoin`'s `runes/undo.ts`),
 *  duplicated per-domain like every other Streams/Index margin constant in
 *  this codebase (e.g. `STREAMS_TIP_REORG_MARGIN_BLOCKS` vs the internal
 *  variant) rather than exported and shared. */
const BITCOIN_FINALITY_CONFIRMATIONS = 6;

const TIP_CACHE_TTL_MS = 500;

export type StreamsBitcoinTip = {
	block_height: number;
	block_hash: string;
	finalized_height: number;
	lag_seconds: number;
};

const EMPTY_BITCOIN_STREAMS_TIP: StreamsBitcoinTip = {
	block_height: 0,
	block_hash:
		"0000000000000000000000000000000000000000000000000000000000000000",
	finalized_height: 0,
	lag_seconds: 0,
};

export type StreamsBitcoinTipProvider = () => Promise<StreamsBitcoinTip>;

let tipCache: { expiresAt: number; value: StreamsBitcoinTip } | null = null;

type CheckpointRow = { height: number; hash: string; updated_at: Date };

/**
 * The `chain=bitcoin` tip: the `runes_checkpoint` row's height + hash (the
 * highest Bitcoin block Runes ingest has flushed), a `finalized_height`
 * `BITCOIN_FINALITY_CONFIRMATIONS` behind it, and staleness. A separate query
 * from `../bitcoin/db.ts`'s `getBitcoinTip` (058) because that reader omits
 * `hash` — Streams' tip envelope needs a `block_hash` field the Index one
 * doesn't.
 */
export async function getStreamsBitcoinTip(
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<StreamsBitcoinTip> {
	const nowMs = Date.now();
	if (tipCache && nowMs < tipCache.expiresAt) return tipCache.value;
	if (!db) return EMPTY_BITCOIN_STREAMS_TIP;

	const row = (await db
		.selectFrom("runes_checkpoint")
		.select(["height", "hash", "updated_at"])
		.where("name", "=", CHECKPOINT_NAME)
		.executeTakeFirst()) as CheckpointRow | undefined;
	const value: StreamsBitcoinTip = row
		? {
				block_height: row.height,
				block_hash: row.hash,
				finalized_height: Math.max(
					0,
					row.height - BITCOIN_FINALITY_CONFIRMATIONS,
				),
				lag_seconds: Math.max(
					0,
					Math.round((nowMs - row.updated_at.getTime()) / 1000),
				),
			}
		: EMPTY_BITCOIN_STREAMS_TIP;

	tipCache = { expiresAt: nowMs + TIP_CACHE_TTL_MS, value };
	return value;
}

/** Test-only: drop the tip cache between fixtures in the same process. */
export function _resetStreamsBitcoinTipCacheForTests(): void {
	tipCache = null;
}

export type StreamsBitcoinCanonicalBlock = {
	block_height: number;
	block_hash: string;
	is_canonical: true;
};

/** `/v1/streams/canonical/:height?chain=bitcoin` — no `burn_block_height`/
 *  `burn_block_hash` fields (Bitcoin has no burn chain of its own), unlike the
 *  Stacks shape at the same route. */
export async function readStreamsBitcoinCanonicalBlock(
	height: number,
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<StreamsBitcoinCanonicalBlock | null> {
	if (!db) return null;
	const row = await db
		.selectFrom("btc_blocks")
		.select(["height", "hash"])
		.where("height", "=", height)
		.executeTakeFirst();
	if (!row) return null;
	return { block_height: row.height, block_hash: row.hash, is_canonical: true };
}

// ── kind mapping (wire <-> DB), mirrors ../index/runes.ts ─────────────────

type DbRuneEventKind = "etch" | "mint" | "transfer" | "burn";

const RUNE_EVENT_TYPE_WIRE_TO_DB: Record<RuneEventType, DbRuneEventKind> = {
	rune_etch: "etch",
	rune_mint: "mint",
	rune_transfer: "transfer",
	rune_burn: "burn",
};

const RUNE_EVENT_TYPE_DB_TO_WIRE: Record<DbRuneEventKind, RuneEventType> = {
	etch: "rune_etch",
	mint: "rune_mint",
	transfer: "rune_transfer",
	burn: "rune_burn",
};

const RUNE_EVENT_TYPE_SET = new Set<string>(RUNE_EVENT_TYPES);

function parseBitcoinTypes(
	value: string | undefined,
): DbRuneEventKind[] | undefined {
	if (value === undefined) return undefined;
	const types = value.split(",").map((part) => part.trim());
	if (types.length === 0 || types.some((type) => type.length === 0)) {
		throw new ValidationError("types must be a comma-separated list");
	}
	const unknown = types.filter((type) => !RUNE_EVENT_TYPE_SET.has(type));
	if (unknown.length > 0) {
		throw new ValidationError(
			`Unknown Streams event type for chain=bitcoin: ${unknown[0]} (use ${RUNE_EVENT_TYPES.join(", ")})`,
		);
	}
	return types.map((type) => RUNE_EVENT_TYPE_WIRE_TO_DB[type as RuneEventType]);
}

/** Params that only make sense for the Stacks payload shape — accepting them
 *  on `chain=bitcoin` would silently return an unfiltered (or wrongly
 *  filtered) page under a filter the caller believes applied. Same posture as
 *  `clock=vm`'s rejection of classic-only params in `./events.ts`. */
const STACKS_ONLY_PARAMS = [
	"contract_id",
	"sender",
	"recipient",
	"asset_identifier",
	"filters",
	"event_type",
] as const;

export function assertNoStacksOnlyParams(query: URLSearchParams): void {
	for (const key of STACKS_ONLY_PARAMS) {
		if (query.get(key) !== null) {
			throw new ValidationError(
				`${key} is Stacks-only (chain=stacks); drop it for chain=bitcoin`,
			);
		}
	}
	if (query.get("clock") === "vm") {
		throw new ValidationError(
			"clock=vm is Stacks-only; drop it for chain=bitcoin",
		);
	}
}

export type StreamsBitcoinEventsQuery = {
	cursor?: StreamsCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	types?: DbRuneEventKind[];
	notTypes?: DbRuneEventKind[];
	rune?: RuneRef;
	address?: string;
	limit: number;
	cursorPastTip: boolean;
};

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 100;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new ValidationError("limit must be a positive integer");
	}
	return Math.min(1000, parsed);
}

export function parseStreamsBitcoinEventsQuery(
	query: URLSearchParams,
	tip: StreamsBitcoinTip,
): StreamsBitcoinEventsQuery {
	assertNoStacksOnlyParams(query);

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
	const toHeight =
		requestedToHeight === undefined
			? tip.block_height
			: Math.min(requestedToHeight, tip.block_height);
	const defaultFromHeight =
		cursorRaw === undefined && fromHeightRaw === undefined
			? Math.max(0, tip.block_height - BITCOIN_BLOCKS_PER_DAY)
			: undefined;

	const runeRaw = query.get("rune") ?? undefined;

	return {
		cursor,
		cursorRaw,
		fromHeight: fromHeight ?? defaultFromHeight ?? 0,
		toHeight,
		types: parseBitcoinTypes(query.get("types") ?? undefined),
		notTypes: parseBitcoinTypes(query.get("not_types") ?? undefined),
		rune: runeRaw !== undefined ? parseRuneRef(runeRaw) : undefined,
		address: query.get("address") ?? undefined,
		limit: parseLimit(query.get("limit") ?? undefined),
		cursorPastTip: cursor ? cursor.block_height > tip.block_height : false,
	};
}

// ── rune_events reader ──────────────────────────────────────────────────

type RuneStreamsEventDbRow = {
	block_height: string | number;
	block_hash: string;
	tx_index: string | number;
	txid: string;
	event_index: string | number;
	kind: DbRuneEventKind;
	rune_id: string;
	amount: string;
	vout: number | null;
	address: string | null;
	name: string | null;
	spaced_rune: string | null;
	symbol: string | null;
	divisibility: number | null;
	premine: string | null;
	turbo: boolean | null;
	terms_amount: string | null;
	terms_cap: string | null;
	terms_height_start: string | null;
	terms_height_end: string | null;
	terms_offset_start: string | null;
	terms_offset_end: string | null;
	has_terms: boolean | null;
};

function normalizeRuneStreamsEvent(
	row: RuneStreamsEventDbRow,
): RuneStreamsEvent {
	const blockHeight = Number(row.block_height);
	const eventIndex = Number(row.event_index);
	const payload: RuneEventPayload = { amount: row.amount };
	if (row.vout !== null) payload.vout = row.vout;
	if (row.address !== null) payload.address = row.address;
	if (row.kind === "etch") {
		const entry: RuneEtchEntry = {
			name: row.name ?? "",
			spaced_name: row.spaced_rune ?? "",
			symbol: row.symbol,
			divisibility: row.divisibility ?? 0,
			premine: row.premine ?? "0",
			turbo: row.turbo ?? false,
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
		payload.entry = entry;
	}

	return {
		cursor: encodeStreamsCursor({
			block_height: blockHeight,
			event_index: eventIndex,
		}),
		chain: "bitcoin",
		block_height: blockHeight,
		block_hash: row.block_hash,
		tx_id: row.txid,
		tx_index: Number(row.tx_index),
		event_index: eventIndex,
		event_type: RUNE_EVENT_TYPE_DB_TO_WIRE[row.kind],
		rune_id: row.rune_id,
		payload,
	};
}

const RUNE_STREAMS_EVENT_COLUMNS = sql`
	e.height AS block_height,
	bb.hash AS block_hash,
	e.tx_index,
	e.txid,
	e.event_index,
	e.kind,
	e.rune_id,
	e.amount,
	e.vout,
	e.address,
	re.name,
	re.spaced_rune,
	re.symbol,
	re.divisibility,
	re.premine,
	re.turbo,
	re.terms_amount,
	re.terms_cap,
	re.terms_height_start,
	re.terms_height_end,
	re.terms_offset_start,
	re.terms_offset_end,
	re.has_terms`;

export type ReadStreamsBitcoinEventsParams = {
	after?: StreamsCursorInput;
	fromHeight: number;
	toHeight: number;
	types?: DbRuneEventKind[];
	notTypes?: DbRuneEventKind[];
	rune?: RuneRef;
	address?: string;
	limit: number;
	db?: Kysely<BitcoinDatabase>;
};

export type ReadStreamsBitcoinEventsResult = {
	events: RuneStreamsEvent[];
	next_cursor: string | null;
};

export type StreamsBitcoinEventsReader = (
	params: ReadStreamsBitcoinEventsParams,
) => Promise<ReadStreamsBitcoinEventsResult>;

/** Resolve a `RuneRef` name to its `rune_id`; an id-form ref already is the
 *  key. Mirrors `../index/runes.ts`'s private `resolveRuneId`. */
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
	return row?.rune_id;
}

export async function readStreamsBitcoinEvents(
	params: ReadStreamsBitcoinEventsParams,
): Promise<ReadStreamsBitcoinEventsResult> {
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

	const includedKinds = params.types
		? params.types.filter((kind) => !params.notTypes?.includes(kind))
		: (["etch", "mint", "transfer", "burn"] as DbRuneEventKind[]).filter(
				(kind) => !params.notTypes?.includes(kind),
			);
	if (includedKinds.length === 0) {
		return { events: [], next_cursor: null };
	}

	const predicates: RawBuilder<unknown>[] = [
		sql`e.height >= ${params.fromHeight}`,
		sql`e.height <= ${params.toHeight}`,
		sql`e.kind = ANY(${includedKinds})`,
	];
	if (runeId) predicates.push(sql`e.rune_id = ${runeId}`);
	if (params.address) predicates.push(sql`e.address = ${params.address}`);
	if (params.after) {
		predicates.push(
			sql`(e.height, e.event_index) > (${params.after.block_height}, ${params.after.event_index})`,
		);
	}

	const { rows } = await sql<RuneStreamsEventDbRow>`
		SELECT ${RUNE_STREAMS_EVENT_COLUMNS}
		FROM rune_events e
		JOIN btc_blocks bb ON bb.height = e.height
		LEFT JOIN rune_entries re ON re.rune_id = e.rune_id
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY e.height ASC, e.event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const page = rows.slice(0, params.limit);
	const lastRow = page.at(-1);
	const events = page.map(normalizeRuneStreamsEvent);
	// Same "advance past a fully-filtered range" rule as the Stacks reader
	// (`../../indexer/src/streams-events.ts`): a filter that eliminates every
	// row in the scanned window must not pin the consumer at the old cursor.
	const next_cursor = lastRow
		? encodeStreamsCursor({
				block_height: Number(lastRow.block_height),
				event_index: Number(lastRow.event_index),
			})
		: rows.length === 0
			? null
			: encodeStreamsCursor({
					block_height: params.toHeight,
					event_index: 2_147_483_647,
				});
	return { events, next_cursor };
}

/** `finalized` is computed at the route layer, not the reader, mirroring
 *  `../streams/events.ts`'s `markFinalized`. */
export function markBitcoinFinalized(
	events: readonly RuneStreamsEvent[],
	finalizedHeight: number,
): RuneStreamsEvent[] {
	return events.map((event) => ({
		...event,
		finalized: event.block_height <= finalizedHeight,
	}));
}

export type StreamsBitcoinEventsResponse = {
	events: RuneStreamsEvent[];
	next_cursor: string | null;
	tip: StreamsBitcoinTip;
	reorgs: StreamsReorg[];
};

/** `chain=bitcoin` counterpart of `../streams/events.ts`'s
 *  `getStreamsEventsResponse` — same cursor-past-tip short-circuit and reorg
 *  range shape, without the classic/vm clock split (bitcoin has one clock). */
export async function getStreamsBitcoinEventsResponse(opts: {
	query: URLSearchParams;
	tip: StreamsBitcoinTip;
	readEvents?: StreamsBitcoinEventsReader;
	readReorgs?: StreamsReorgsReader;
}): Promise<StreamsBitcoinEventsResponse> {
	const parsed = parseStreamsBitcoinEventsQuery(opts.query, opts.tip);
	const readReorgs = opts.readReorgs ?? (async () => []);

	if (parsed.cursorPastTip) {
		return {
			events: [],
			next_cursor: parsed.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
		};
	}

	const readEvents = opts.readEvents ?? readStreamsBitcoinEvents;
	const result = await readEvents({
		after: parsed.cursor,
		fromHeight: parsed.fromHeight,
		toHeight: parsed.toHeight,
		types: parsed.types,
		notTypes: parsed.notTypes,
		rune: parsed.rune,
		address: parsed.address,
		limit: parsed.limit,
	});

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
		events: markBitcoinFinalized(result.events, opts.tip.finalized_height),
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
	};
}

export type ReadStreamsBitcoinEventsByTxIdParams = { txId: string };
export type ReadStreamsBitcoinBlockEventsParams = {
	blockHeight?: number;
	blockHash?: string;
};
export type ReadStreamsBitcoinEventsListResult = { events: RuneStreamsEvent[] };

export async function readStreamsBitcoinEventsByTxId(
	params: ReadStreamsBitcoinEventsByTxIdParams,
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<ReadStreamsBitcoinEventsListResult> {
	if (!db) return { events: [] };
	const { rows } = await sql<RuneStreamsEventDbRow>`
		SELECT ${RUNE_STREAMS_EVENT_COLUMNS}
		FROM rune_events e
		JOIN btc_blocks bb ON bb.height = e.height
		LEFT JOIN rune_entries re ON re.rune_id = e.rune_id
		WHERE e.txid = ${params.txId}
		ORDER BY e.height ASC, e.event_index ASC
	`.execute(db);
	return { events: rows.map(normalizeRuneStreamsEvent) };
}

export async function readStreamsBitcoinBlockEvents(
	params: ReadStreamsBitcoinBlockEventsParams,
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<ReadStreamsBitcoinEventsListResult> {
	if (!db) return { events: [] };
	if (params.blockHeight === undefined && !params.blockHash) {
		return { events: [] };
	}
	const blockPredicate =
		params.blockHeight !== undefined
			? sql`e.height = ${params.blockHeight}`
			: sql`bb.hash = ${params.blockHash}`;
	const { rows } = await sql<RuneStreamsEventDbRow>`
		SELECT ${RUNE_STREAMS_EVENT_COLUMNS}
		FROM rune_events e
		JOIN btc_blocks bb ON bb.height = e.height
		LEFT JOIN rune_entries re ON re.rune_id = e.rune_id
		WHERE ${blockPredicate}
		ORDER BY e.height ASC, e.event_index ASC
	`.execute(db);
	return { events: rows.map(normalizeRuneStreamsEvent) };
}

// ── reorgs (btc_reorgs, normalized to the Stacks ChainReorgRecord shape) ──

/**
 * `readBtcReorgs` (058) returns `BtcReorg` — block-level fields
 * (`orphaned_from`/`orphaned_to`/`new_tip_height`), not the Stacks
 * `ChainReorgRecord` wire shape Streams already serves (`orphaned_range`,
 * `new_canonical_tip`). Plan 059 wants the SAME wire shape for both chains so
 * the SDK's existing reorg-rewind logic (keyed on `fork_point_height` +
 * `new_canonical_tip`) works unchanged for `chain=bitcoin` with no SDK
 * changes. Bitcoin has no event_index concept, so every encoded cursor here
 * uses `:0` (orphaned_from / new_canonical_tip) or the block-end sentinel
 * (orphaned_to) — "resume at the foot of the new canonical block", the same
 * conservative rewind point Stacks uses at a fork.
 */
function normalizeBitcoinReorg(reorg: {
	id: string;
	detected_at: string;
	fork_point_height: number;
	old_hash: string;
	new_hash: string;
	orphaned_from: number;
	orphaned_to: number;
	new_tip_height: number;
}): StreamsReorg {
	return {
		id: reorg.id,
		detected_at: reorg.detected_at,
		fork_point_height: reorg.fork_point_height,
		old_index_block_hash: reorg.old_hash,
		new_index_block_hash: reorg.new_hash,
		orphaned_range: {
			from: encodeStreamsCursor({
				block_height: reorg.orphaned_from,
				event_index: 0,
			}),
			to: encodeStreamsCursor({
				block_height: reorg.orphaned_to,
				event_index: 2_147_483_647,
			}),
		},
		new_canonical_tip: encodeStreamsCursor({
			block_height: reorg.new_tip_height,
			event_index: 0,
		}),
	};
}

export const readStreamsBitcoinReorgs: StreamsReorgsReader = async (range) => {
	const reorgs = await readBtcReorgs(
		range.from.block_height,
		range.to.block_height,
	);
	return reorgs.map(normalizeBitcoinReorg);
};

export type StreamsBitcoinReorgsSinceParams = {
	since: string;
	limit: number;
};

/** `/v1/streams/reorgs?chain=bitcoin&since=...` — same time-cursor semantics
 *  as `readChainReorgsSince` (`packages/shared/src/db/queries/chain-reorgs.ts`),
 *  reimplemented against `btc_reorgs` (a separate Postgres, D18). */
export async function readStreamsBitcoinReorgsSince(
	params: StreamsBitcoinReorgsSinceParams,
	db: Kysely<BitcoinDatabase> | undefined = getBitcoinDb(),
): Promise<StreamsReorg[]> {
	if (!db) return [];
	const limit = Math.min(1000, Math.max(1, params.limit));
	const tilde = params.since.indexOf("~");
	const detectedAt = tilde === -1 ? params.since : params.since.slice(0, tilde);
	const id = tilde === -1 ? null : params.since.slice(tilde + 1);

	const rows = id
		? await sql<{
				id: string;
				detected_at: Date;
				fork_point_height: number;
				old_hash: string;
				new_hash: string;
				orphaned_from: number;
				orphaned_to: number;
				new_tip_height: number;
			}>`
				SELECT * FROM btc_reorgs
				WHERE (detected_at, id) > ((${detectedAt}::text)::timestamptz, ${id}::bigint)
				ORDER BY detected_at ASC, id ASC
				LIMIT ${limit}
			`.execute(db)
		: await sql<{
				id: string;
				detected_at: Date;
				fork_point_height: number;
				old_hash: string;
				new_hash: string;
				orphaned_from: number;
				orphaned_to: number;
				new_tip_height: number;
			}>`
				SELECT * FROM btc_reorgs
				WHERE detected_at > (${detectedAt}::text)::timestamptz
				ORDER BY detected_at ASC, id ASC
				LIMIT ${limit}
			`.execute(db);

	return rows.rows.map((row) =>
		normalizeBitcoinReorg({
			...row,
			detected_at: row.detected_at.toISOString(),
		}),
	);
}

export function encodeBitcoinReorgsNextSince(reorg: StreamsReorg): string {
	// btc_reorgs.id is bigserial (see migrations/0004), not a uuid — the tilde
	// separator + text id are exactly `./reorgs.ts`'s `encodeReorgsNextSince`
	// shape, just without the uuid assumption baked into its parser.
	return `${reorg.detected_at}~${reorg.id}`;
}
