import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { SbtcEventTopic } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import { deserializeCVBytes } from "@secondlayer/stacks/clarity";
import type { Kysely, RawBuilder } from "kysely";
import type { StreamsReorg, StreamsReorgsReader } from "../streams/reorgs.ts";
import {
	type IndexCursorInput,
	encodeIndexCursor,
	parseCursor,
	parseFilter,
	parseIndexBaseQuery,
	readReorgsForEvents,
	toIsoOrNull,
} from "./_shared.ts";
import type { IndexTip } from "./tip.ts";

/**
 * Typed sBTC peg read surface over the already-decoded `sbtc_events` table
 * (topics `completed-deposit` / `withdrawal-{create,accept,reject}` /
 * `key-rotation` / `update-protocol-contract`). The single sharpest data-plane
 * moat: Hiro declined peg-event filtering (SBA #1709), so this is the only
 * productized decoded sBTC peg feed on Stacks. Packaging, not ingestion — the
 * rows already exist with reorg-canonical handling.
 *
 * Event-indexed like the decoded-event endpoints: cursor = `block_height:event_index`,
 * sargable `(block_height, event_index)` keyset, reorg reconciliation over the
 * page's event range. Reuses the shared Index helpers so the envelope, finality,
 * and pagination never diverge from the rest of `/v1/index`.
 */

// No `isSbtcDecoderEnabled()` helper exists in @secondlayer/shared (unlike
// isPox4DecoderEnabled). Read the env directly, matching the indexer's inline
// check. Not NODE_ENV, so the bundler doesn't constant-fold it; api runs from
// source regardless.
export function isSbtcDecoderEnabled(): boolean {
	return process.env.SBTC_DECODER_ENABLED !== "false";
}

const SBTC_DISABLED_NOTE =
	"sBTC decoding is disabled (SBTC_DECODER_ENABLED=false); the sBTC peg feed is empty until re-enabled.";

const DEPOSIT_TOPIC: SbtcEventTopic = "completed-deposit";

export const SBTC_EVENTS_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"confirmed",
	"topic",
	"sender",
	"request_id",
	"bitcoin_txid",
] as const;

export const SBTC_DEPOSIT_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"confirmed",
	"sender",
	"bitcoin_txid",
] as const;

export const SBTC_WITHDRAWAL_FILTERS = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"confirmed",
	"status",
	"sender",
	"request_id",
] as const;

export type SbtcWithdrawalStatus = "REQUESTED" | "ACCEPTED" | "REJECTED";

/** A raw decoded sBTC protocol-state event — the full `sbtc_events` row shape
 *  (declared columns in SOURCE_READ_COLUMNS), one per event across all topics. */
export type SbtcEvent = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: SbtcEventTopic;
	request_id: number | null;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	bitcoin_txid: string | null;
	output_index: number | null;
	sweep_txid: string | null;
	burn_hash: string | null;
	burn_height: number | null;
	signer_bitmap: string | null;
	max_fee: string | null;
	fee: string | null;
	governance_contract_type: number | null;
	governance_new_contract: string | null;
	signer_aggregate_pubkey: string | null;
	signer_threshold: number | null;
	signer_address: string | null;
	signer_keys_count: number | null;
};

/** A completed peg-in. `completed-deposit` fires only after the signers confirm
 *  the BTC, so a deposit is a single terminal event. Keyed by `bitcoin_txid`
 *  (deposits carry no `request_id`). */
export type SbtcDeposit = {
	cursor: string;
	block_height: number;
	block_time?: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	amount: string | null;
	sender: string | null;
	bitcoin_txid: string | null;
	output_index: number | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
};

/** A peg-out collapsed to one row per `request_id` (the withdrawal-create
 *  spine), with its current lifecycle status derived from the latest
 *  accept/reject. `sweep_txid` is the BTC sweep the signers committed to on
 *  accept — confirmed-on-Bitcoin status is filled later by the settlement
 *  confirmer. */
export type SbtcWithdrawalSummary = {
	cursor: string;
	request_id: number;
	status: SbtcWithdrawalStatus;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	sweep_txid: string | null;
	requested_at?: string | null;
	resolved_at?: string | null;
};

export type SbtcEventsResponse = {
	events: SbtcEvent[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
	notes?: string;
};

export type SbtcDepositsResponse = {
	deposits: SbtcDeposit[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
	notes?: string;
};

export type SbtcWithdrawalsResponse = {
	withdrawals: SbtcWithdrawalSummary[];
	next_cursor: string | null;
	tip: IndexTip;
	reorgs: StreamsReorg[];
	notes?: string;
};

// --- shared query parsing -------------------------------------------------

type SbtcBaseQuery = {
	cursor?: IndexCursorInput;
	cursorRaw?: string;
	fromHeight: number;
	toHeight: number;
	limit: number;
	cursorPastTip: boolean;
};

/** Base window/cursor parse + the `?confirmed=true` hard "settled" filter:
 *  clamp `to_height` to `tip.finalized_height` so only rows past the reorg
 *  margin are returned — the safety-critical view a settlement consumer wants. */
function parseSbtcBaseQuery(
	query: URLSearchParams,
	tip: IndexTip,
): SbtcBaseQuery {
	const base = parseIndexBaseQuery(query, tip);
	const confirmed = query.get("confirmed");
	if (confirmed !== null && confirmed !== "true" && confirmed !== "false") {
		throw new ValidationError("confirmed must be 'true' or 'false'");
	}
	if (confirmed === "true") {
		return { ...base, toHeight: Math.min(base.toHeight, tip.finalized_height) };
	}
	return base;
}

function parseRequestIdFilter(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError("request_id must be a non-negative integer");
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError("request_id must be a non-negative integer");
	}
	return parsed;
}

function keysetPredicate(after: IndexCursorInput): RawBuilder<unknown> {
	// Sargable row-values keyset over (block_height, event_index) — same form as
	// the decoded-event reads, so Postgres range-scans rather than re-scanning.
	return sql`(block_height, event_index) > (${after.block_height}, ${after.event_index})`;
}

// sbtc_events carries its own NOT NULL `block_time` column (unlike pox4_calls /
// decoded_events, which need a correlated `blocks` lookup), so select it directly.
const SBTC_EVENT_COLUMNS = sql`
	cursor,
	block_height,
	block_time,
	tx_id,
	tx_index,
	event_index,
	topic,
	request_id,
	amount,
	sender,
	recipient_btc_version,
	recipient_btc_hashbytes,
	bitcoin_txid,
	output_index,
	sweep_txid,
	burn_hash,
	burn_height,
	signer_bitmap,
	max_fee,
	fee,
	governance_contract_type,
	governance_new_contract,
	signer_aggregate_pubkey,
	signer_threshold,
	signer_address,
	signer_keys_count`;

// --- raw events (T1) ------------------------------------------------------

type SbtcEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string | null;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	topic: SbtcEventTopic;
	request_id: string | number | null;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	bitcoin_txid: string | null;
	output_index: number | null;
	sweep_txid: string | null;
	burn_hash: string | null;
	burn_height: string | number | null;
	signer_bitmap: string | null;
	max_fee: string | null;
	fee: string | null;
	governance_contract_type: number | null;
	governance_new_contract: string | null;
	signer_aggregate_pubkey: string | null;
	signer_threshold: number | null;
	signer_address: string | null;
	signer_keys_count: number | null;
};

function normalizeSbtcEvent(row: SbtcEventDbRow): SbtcEvent {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		topic: row.topic,
		request_id: row.request_id === null ? null : Number(row.request_id),
		amount: row.amount,
		sender: row.sender,
		recipient_btc_version: row.recipient_btc_version,
		recipient_btc_hashbytes: row.recipient_btc_hashbytes,
		bitcoin_txid: row.bitcoin_txid,
		output_index: row.output_index,
		sweep_txid: row.sweep_txid,
		burn_hash: row.burn_hash,
		burn_height: row.burn_height === null ? null : Number(row.burn_height),
		signer_bitmap: row.signer_bitmap,
		max_fee: row.max_fee,
		fee: row.fee,
		governance_contract_type: row.governance_contract_type,
		governance_new_contract: row.governance_new_contract,
		signer_aggregate_pubkey: row.signer_aggregate_pubkey,
		signer_threshold: row.signer_threshold,
		signer_address: row.signer_address,
		signer_keys_count: row.signer_keys_count,
	};
}

export type ReadSbtcEventsParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	topic?: SbtcEventTopic;
	sender?: string;
	requestId?: number;
	bitcoinTxid?: string;
	db?: Kysely<Database>;
};

export type ReadSbtcEventsResult = {
	events: SbtcEvent[];
	next_cursor: string | null;
};

export type SbtcEventsReader = (
	params: ReadSbtcEventsParams,
) => Promise<ReadSbtcEventsResult>;

export async function readSbtcEvents(
	params: ReadSbtcEventsParams,
): Promise<ReadSbtcEventsResult> {
	if (params.toHeight < params.fromHeight) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
	];
	if (params.topic) predicates.push(sql`topic = ${params.topic}`);
	if (params.sender) predicates.push(sql`sender = ${params.sender}`);
	if (params.requestId !== undefined) {
		predicates.push(sql`request_id = ${params.requestId}`);
	}
	if (params.bitcoinTxid) {
		predicates.push(sql`bitcoin_txid = ${params.bitcoinTxid}`);
	}
	if (params.after) predicates.push(keysetPredicate(params.after));

	const { rows } = await sql<SbtcEventDbRow>`
		SELECT ${SBTC_EVENT_COLUMNS}
		FROM sbtc_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const events = rows.slice(0, params.limit).map(normalizeSbtcEvent);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last
			? encodeIndexCursor({
					block_height: last.block_height,
					event_index: last.event_index,
				})
			: null,
	};
}

function isSbtcTopic(value: string): value is SbtcEventTopic {
	return (
		value === "completed-deposit" ||
		value === "withdrawal-create" ||
		value === "withdrawal-accept" ||
		value === "withdrawal-reject" ||
		value === "key-rotation" ||
		value === "update-protocol-contract"
	);
}

export async function getSbtcEventsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readSbtcEvents?: SbtcEventsReader;
	readReorgs?: StreamsReorgsReader;
	decoderEnabled?: boolean;
}): Promise<SbtcEventsResponse> {
	const base = parseSbtcBaseQuery(opts.query, opts.tip);
	const note =
		(opts.decoderEnabled ?? isSbtcDecoderEnabled())
			? undefined
			: SBTC_DISABLED_NOTE;

	const topicRaw = opts.query.get("topic") ?? undefined;
	if (topicRaw !== undefined && !isSbtcTopic(topicRaw)) {
		throw new ValidationError(`unknown topic: ${topicRaw}`);
	}

	if (base.cursorPastTip) {
		return {
			events: [],
			next_cursor: base.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
			...(note ? { notes: note } : {}),
		};
	}

	const reader = opts.readSbtcEvents ?? readSbtcEvents;
	const result = await reader({
		after: base.cursor,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
		topic: topicRaw as SbtcEventTopic | undefined,
		sender: parseFilter(opts.query.get("sender") ?? undefined, "sender"),
		requestId: parseRequestIdFilter(opts.query.get("request_id") ?? undefined),
		bitcoinTxid: parseFilter(
			opts.query.get("bitcoin_txid") ?? undefined,
			"bitcoin_txid",
		),
	});
	const reorgs = await readReorgsForEvents(result.events, opts.readReorgs);
	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
		...(note ? { notes: note } : {}),
	};
}

// --- deposits (T2) --------------------------------------------------------

function normalizeSbtcDeposit(row: SbtcEventDbRow): SbtcDeposit {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		amount: row.amount,
		sender: row.sender,
		bitcoin_txid: row.bitcoin_txid,
		output_index: row.output_index,
		recipient_btc_version: row.recipient_btc_version,
		recipient_btc_hashbytes: row.recipient_btc_hashbytes,
	};
}

export type ReadSbtcDepositsParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	sender?: string;
	bitcoinTxid?: string;
	db?: Kysely<Database>;
};

export type ReadSbtcDepositsResult = {
	deposits: SbtcDeposit[];
	next_cursor: string | null;
};

export type SbtcDepositsReader = (
	params: ReadSbtcDepositsParams,
) => Promise<ReadSbtcDepositsResult>;

export async function readSbtcDeposits(
	params: ReadSbtcDepositsParams,
): Promise<ReadSbtcDepositsResult> {
	if (params.toHeight < params.fromHeight) {
		return { deposits: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();
	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`topic = ${DEPOSIT_TOPIC}`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
	];
	if (params.sender) predicates.push(sql`sender = ${params.sender}`);
	if (params.bitcoinTxid) {
		predicates.push(sql`bitcoin_txid = ${params.bitcoinTxid}`);
	}
	if (params.after) predicates.push(keysetPredicate(params.after));

	const { rows } = await sql<SbtcEventDbRow>`
		SELECT ${SBTC_EVENT_COLUMNS}
		FROM sbtc_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const deposits = rows.slice(0, params.limit).map(normalizeSbtcDeposit);
	const last = deposits.at(-1);
	return {
		deposits,
		next_cursor: last
			? encodeIndexCursor({
					block_height: last.block_height,
					event_index: last.event_index,
				})
			: null,
	};
}

export async function getSbtcDepositsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readSbtcDeposits?: SbtcDepositsReader;
	readReorgs?: StreamsReorgsReader;
	decoderEnabled?: boolean;
}): Promise<SbtcDepositsResponse> {
	const base = parseSbtcBaseQuery(opts.query, opts.tip);
	const note =
		(opts.decoderEnabled ?? isSbtcDecoderEnabled())
			? undefined
			: SBTC_DISABLED_NOTE;

	if (base.cursorPastTip) {
		return {
			deposits: [],
			next_cursor: base.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
			...(note ? { notes: note } : {}),
		};
	}

	const reader = opts.readSbtcDeposits ?? readSbtcDeposits;
	const result = await reader({
		after: base.cursor,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
		sender: parseFilter(opts.query.get("sender") ?? undefined, "sender"),
		bitcoinTxid: parseFilter(
			opts.query.get("bitcoin_txid") ?? undefined,
			"bitcoin_txid",
		),
	});
	const reorgs = await readReorgsForEvents(result.deposits, opts.readReorgs);
	return {
		deposits: result.deposits,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
		...(note ? { notes: note } : {}),
	};
}

// --- withdrawals rolled-up list (T3) --------------------------------------

type SbtcWithdrawalSummaryDbRow = {
	cursor: string;
	block_height: string | number;
	event_index: string | number;
	request_id: string | number;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	requested_at: Date | string | null;
	resolution_topic: SbtcEventTopic | null;
	sweep_txid: string | null;
	resolved_at: Date | string | null;
};

function deriveStatus(
	resolutionTopic: SbtcEventTopic | null,
): SbtcWithdrawalStatus {
	if (resolutionTopic === "withdrawal-accept") return "ACCEPTED";
	if (resolutionTopic === "withdrawal-reject") return "REJECTED";
	return "REQUESTED";
}

function normalizeSbtcWithdrawalSummary(
	row: SbtcWithdrawalSummaryDbRow,
): SbtcWithdrawalSummary {
	return {
		cursor: row.cursor,
		request_id: Number(row.request_id),
		status: deriveStatus(row.resolution_topic),
		amount: row.amount,
		sender: row.sender,
		recipient_btc_version: row.recipient_btc_version,
		recipient_btc_hashbytes: row.recipient_btc_hashbytes,
		sweep_txid: row.sweep_txid,
		requested_at: toIsoOrNull(row.requested_at),
		resolved_at: toIsoOrNull(row.resolved_at),
	};
}

export type ReadSbtcWithdrawalsParams = {
	after?: IndexCursorInput;
	fromHeight: number;
	toHeight: number;
	limit: number;
	status?: SbtcWithdrawalStatus;
	sender?: string;
	requestId?: number;
	db?: Kysely<Database>;
};

export type ReadSbtcWithdrawalsResult = {
	withdrawals: SbtcWithdrawalSummary[];
	next_cursor: string | null;
};

export type SbtcWithdrawalsReader = (
	params: ReadSbtcWithdrawalsParams,
) => Promise<ReadSbtcWithdrawalsResult>;

export async function readSbtcWithdrawals(
	params: ReadSbtcWithdrawalsParams,
): Promise<ReadSbtcWithdrawalsResult> {
	if (params.toHeight < params.fromHeight) {
		return { withdrawals: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();

	// The withdrawal-create event is the per-request spine (one per request_id;
	// DISTINCT ON is defensive — no DB unique constraint). Each is enriched with
	// the latest accept/reject for the same request_id to derive the current
	// status + the committed BTC sweep_txid. Correlated LATERAL is O(page); fine
	// at sBTC volume — deliberately no composite index added.
	const createPredicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`topic = 'withdrawal-create'`,
		sql`block_height >= ${params.fromHeight}`,
		sql`block_height <= ${params.toHeight}`,
	];
	if (params.sender) createPredicates.push(sql`sender = ${params.sender}`);
	if (params.requestId !== undefined) {
		createPredicates.push(sql`request_id = ${params.requestId}`);
	}
	if (params.after) createPredicates.push(keysetPredicate(params.after));

	// Status filter pushed into SQL (post-LATERAL) so LIMIT n+1 counts only
	// matching rows and hasMore detection stays correct.
	const statusPredicate =
		params.status === "ACCEPTED"
			? sql`res.resolution_topic = 'withdrawal-accept'`
			: params.status === "REJECTED"
				? sql`res.resolution_topic = 'withdrawal-reject'`
				: params.status === "REQUESTED"
					? sql`res.resolution_topic IS NULL`
					: sql`true`;

	const { rows } = await sql<SbtcWithdrawalSummaryDbRow>`
		SELECT
			c.cursor,
			c.block_height,
			c.event_index,
			c.request_id,
			c.amount,
			c.sender,
			c.recipient_btc_version,
			c.recipient_btc_hashbytes,
			c.block_time AS requested_at,
			res.resolution_topic,
			res.sweep_txid,
			res.resolved_at
		FROM (
			SELECT DISTINCT ON (request_id)
				cursor, block_height, event_index, block_time, request_id, amount,
				sender, recipient_btc_version, recipient_btc_hashbytes
			FROM sbtc_events
			WHERE ${sql.join(createPredicates, sql` AND `)}
			ORDER BY request_id, block_height ASC, event_index ASC
		) c
		LEFT JOIN LATERAL (
			SELECT r.topic AS resolution_topic, r.sweep_txid,
				r.block_time AS resolved_at
			FROM sbtc_events r
			WHERE r.canonical = true
				AND r.request_id = c.request_id
				AND r.topic IN ('withdrawal-accept', 'withdrawal-reject')
			ORDER BY r.block_height DESC, r.event_index DESC
			LIMIT 1
		) res ON true
		WHERE ${statusPredicate}
		ORDER BY c.block_height ASC, c.event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const withdrawals = pageRows.map(normalizeSbtcWithdrawalSummary);
	const last = pageRows.at(-1);
	return {
		withdrawals,
		next_cursor: last
			? encodeIndexCursor({
					block_height: Number(last.block_height),
					event_index: Number(last.event_index),
				})
			: null,
	};
}

function parseStatusFilter(
	value: string | undefined,
): SbtcWithdrawalStatus | undefined {
	if (value === undefined) return undefined;
	if (value !== "REQUESTED" && value !== "ACCEPTED" && value !== "REJECTED") {
		throw new ValidationError(
			"status must be one of REQUESTED, ACCEPTED, REJECTED",
		);
	}
	return value;
}

export async function getSbtcWithdrawalsResponse(opts: {
	query: URLSearchParams;
	tip: IndexTip;
	readSbtcWithdrawals?: SbtcWithdrawalsReader;
	readReorgs?: StreamsReorgsReader;
	decoderEnabled?: boolean;
}): Promise<SbtcWithdrawalsResponse> {
	const base = parseSbtcBaseQuery(opts.query, opts.tip);
	const note =
		(opts.decoderEnabled ?? isSbtcDecoderEnabled())
			? undefined
			: SBTC_DISABLED_NOTE;

	if (base.cursorPastTip) {
		return {
			withdrawals: [],
			next_cursor: base.cursorRaw ?? null,
			tip: opts.tip,
			reorgs: [],
			...(note ? { notes: note } : {}),
		};
	}

	const reader = opts.readSbtcWithdrawals ?? readSbtcWithdrawals;
	const result = await reader({
		after: base.cursor,
		fromHeight: base.fromHeight,
		toHeight: base.toHeight,
		limit: base.limit,
		status: parseStatusFilter(opts.query.get("status") ?? undefined),
		sender: parseFilter(opts.query.get("sender") ?? undefined, "sender"),
		requestId: parseRequestIdFilter(opts.query.get("request_id") ?? undefined),
	});

	// Reorg reconciliation over the create-event range (the summary cursor keys on
	// the create event); decode each via the canonical cursor parser.
	const reorgs = await readReorgsForEvents(
		result.withdrawals.map((w) => parseCursor(w.cursor)),
		opts.readReorgs,
	);
	return {
		withdrawals: result.withdrawals,
		next_cursor: result.next_cursor,
		tip: opts.tip,
		reorgs,
		...(note ? { notes: note } : {}),
	};
}

// --- by-id lifecycle detail (T6) ------------------------------------------

/** One phase of a withdrawal's lifecycle (the on-Stacks event that drove it). */
export type SbtcWithdrawalPhase = {
	block_height: number;
	block_time: string | null;
	tx_id: string;
};

/** A single peg-out's full assembled lifecycle, joined by request_id. The
 *  settlement block is a placeholder until the BTC L1 confirmer fills
 *  btc_confirmations + settlement_confirmed for the committed sweep. */
export type SbtcWithdrawalLifecycle = {
	request_id: number;
	status: SbtcWithdrawalStatus;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	requested: SbtcWithdrawalPhase;
	accepted:
		| (SbtcWithdrawalPhase & {
				sweep_txid: string | null;
				signer_bitmap: string | null;
		  })
		| null;
	rejected: SbtcWithdrawalPhase | null;
	settlement: {
		sweep_txid: string | null;
		btc_confirmations: number | null;
		settlement_confirmed: boolean | null;
	};
	/** The highest block_height across the lifecycle's events — the route uses it
	 *  to decide finality (and whether the row is immutably cacheable). */
	latest_height: number;
};

/** A completed peg-in fetched by its Bitcoin txid (deposits carry no request_id).
 *  Single terminal event, so status is always COMPLETED. */
export type SbtcDepositDetail = SbtcDeposit & { status: "COMPLETED" };

type SbtcLifecycleDbRow = {
	block_height: string | number;
	block_time: Date | string | null;
	event_index: string | number;
	tx_id: string;
	topic: SbtcEventTopic;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: number | null;
	recipient_btc_hashbytes: string | null;
	sweep_txid: string | null;
	signer_bitmap: string | null;
};

function phaseOf(row: SbtcLifecycleDbRow): SbtcWithdrawalPhase {
	return {
		block_height: Number(row.block_height),
		block_time: toIsoOrNull(row.block_time),
		tx_id: row.tx_id,
	};
}

export async function readSbtcWithdrawalById(
	requestId: number,
	opts?: { db?: Kysely<Database> },
): Promise<SbtcWithdrawalLifecycle | null> {
	const db = opts?.db ?? getSourceDb();
	const { rows } = await sql<SbtcLifecycleDbRow>`
		SELECT
			block_height, block_time, event_index, tx_id, topic,
			amount, sender, recipient_btc_version, recipient_btc_hashbytes,
			sweep_txid, signer_bitmap
		FROM sbtc_events
		WHERE canonical = true
			AND request_id = ${requestId}
			AND topic IN ('withdrawal-create', 'withdrawal-accept', 'withdrawal-reject')
		ORDER BY block_height ASC, event_index ASC
	`.execute(db);

	const createRow = rows.find((r) => r.topic === "withdrawal-create");
	// Without a create event there is no withdrawal to report (orphan accept/reject).
	if (!createRow) return null;

	// Latest resolution wins (canonical chain yields at most one, but be defensive).
	const acceptRow = rows.filter((r) => r.topic === "withdrawal-accept").at(-1);
	const rejectRow = rows.filter((r) => r.topic === "withdrawal-reject").at(-1);
	const resolution =
		acceptRow && rejectRow
			? Number(acceptRow.block_height) >= Number(rejectRow.block_height)
				? acceptRow
				: rejectRow
			: (acceptRow ?? rejectRow);

	const status: SbtcWithdrawalStatus =
		resolution?.topic === "withdrawal-accept"
			? "ACCEPTED"
			: resolution?.topic === "withdrawal-reject"
				? "REJECTED"
				: "REQUESTED";

	const latestHeight = rows.reduce(
		(max, r) => Math.max(max, Number(r.block_height)),
		0,
	);

	return {
		request_id: requestId,
		status,
		amount: createRow.amount,
		sender: createRow.sender,
		recipient_btc_version: createRow.recipient_btc_version,
		recipient_btc_hashbytes: createRow.recipient_btc_hashbytes,
		requested: phaseOf(createRow),
		accepted: acceptRow
			? {
					...phaseOf(acceptRow),
					sweep_txid: acceptRow.sweep_txid,
					signer_bitmap: acceptRow.signer_bitmap,
				}
			: null,
		rejected: rejectRow ? phaseOf(rejectRow) : null,
		settlement: {
			sweep_txid: acceptRow?.sweep_txid ?? null,
			btc_confirmations: null,
			settlement_confirmed: null,
		},
		latest_height: latestHeight,
	};
}

export type SbtcWithdrawalByIdReader = (
	requestId: number,
) => Promise<SbtcWithdrawalLifecycle | null>;

export async function readSbtcDepositByBitcoinTxid(
	bitcoinTxid: string,
	opts?: { db?: Kysely<Database> },
): Promise<SbtcDepositDetail | null> {
	const db = opts?.db ?? getSourceDb();
	const { rows } = await sql<SbtcEventDbRow>`
		SELECT ${SBTC_EVENT_COLUMNS}
		FROM sbtc_events
		WHERE canonical = true
			AND topic = ${DEPOSIT_TOPIC}
			AND bitcoin_txid = ${bitcoinTxid}
		ORDER BY block_height ASC, event_index ASC
		LIMIT 1
	`.execute(db);

	const row = rows[0];
	if (!row) return null;
	return { ...normalizeSbtcDeposit(row), status: "COMPLETED" };
}

export type SbtcDepositByTxidReader = (
	bitcoinTxid: string,
) => Promise<SbtcDepositDetail | null>;

// --- summary scoreboard (T7) ----------------------------------------------

/** The peg "scoreboard" cap — a single scalar row summarizing the whole bridge:
 *  lifecycle counts, net peg flow, locked sats, and circulating sBTC supply.
 *  No window/cursor — it's an all-time canonical aggregate. */
export type SbtcSummary = {
	total_deposits: number;
	total_withdrawals_requested: number;
	total_withdrawals_accepted: number;
	total_withdrawals_rejected: number;
	/** SUM(completed-deposit amount) − SUM(withdrawal-accept amount), bigint-safe string. */
	net_peg_flow_sats: string;
	/** Same figure as net_peg_flow_sats: sats deposited minus sats withdrawn-out. */
	total_locked_sats: string;
	/** Circulating sBTC supply in sats, read authoritatively from the sbtc-token
	 *  `get-total-supply` contract function via our own node; null when the node is
	 *  unset/unreachable. Never reconstructed from decoded event deltas. */
	sbtc_supply_sats: string | null;
};

export type SbtcSummaryResponse = {
	summary: SbtcSummary;
	tip: IndexTip;
	notes?: string;
};

export type SbtcSummaryReader = (opts?: {
	db?: Kysely<Database>;
}) => Promise<SbtcSummary>;

type SbtcSummaryDbRow = {
	total_deposits: string | number;
	total_withdrawals_requested: string | number;
	total_withdrawals_accepted: string | number;
	total_withdrawals_rejected: string | number;
	sum_deposits_sats: string;
	sum_accepted_sats: string;
};

/** Reads authoritative circulating sBTC supply (sats) or null when unavailable. */
export type SbtcSupplyReader = () => Promise<string | null>;

const SBTC_TOKEN_CONTRACT =
	"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

/**
 * Authoritative circulating sBTC supply (sats), read from sbtc-token
 * `get-total-supply` on our own Stacks node (`STACKS_NODE_RPC_URL`). Returns null
 * — never throws and never a wrong number — when the node is unset/unreachable or
 * the response is unexpected, so a node hiccup degrades to "unknown", not a 500.
 */
export async function readSbtcTokenSupply(opts?: {
	rpcUrl?: string;
	fetchImpl?: typeof fetch;
}): Promise<string | null> {
	const rpcUrl = opts?.rpcUrl ?? process.env.STACKS_NODE_RPC_URL;
	if (!rpcUrl) return null;
	const [address, name] = SBTC_TOKEN_CONTRACT.split(".");
	const doFetch = opts?.fetchImpl ?? fetch;
	try {
		const res = await doFetch(
			`${rpcUrl.replace(/\/+$/, "")}/v2/contracts/call-read/${address}/${name}/get-total-supply`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sender: address, arguments: [] }),
				signal: AbortSignal.timeout(5000),
			},
		);
		if (!res.ok) return null;
		const data = (await res.json()) as { okay?: boolean; result?: string };
		if (!data.okay || !data.result) return null;
		// (response (ok uint) (err …)) → { type: "ok", value: { type: "uint", value: bigint } }
		const cv = deserializeCVBytes(data.result);
		if (cv.type === "ok" && cv.value.type === "uint") {
			return cv.value.value.toString();
		}
		return null;
	} catch {
		return null;
	}
}

export async function readSbtcSummary(opts?: {
	db?: Kysely<Database>;
}): Promise<SbtcSummary> {
	const db = opts?.db ?? getSourceDb();

	// Counts + flow in one pass over canonical peg events. amount is text; cast to
	// numeric for SUM and return as text. withdrawal-accept rows occasionally lack
	// an amount → COALESCE to 0 so the SUM doesn't go null mid-aggregate.
	const { rows } = await sql<SbtcSummaryDbRow>`
		SELECT
			COUNT(*) FILTER (WHERE topic = 'completed-deposit')::int AS total_deposits,
			COUNT(*) FILTER (WHERE topic = 'withdrawal-create')::int AS total_withdrawals_requested,
			COUNT(*) FILTER (WHERE topic = 'withdrawal-accept')::int AS total_withdrawals_accepted,
			COUNT(*) FILTER (WHERE topic = 'withdrawal-reject')::int AS total_withdrawals_rejected,
			COALESCE(SUM(COALESCE(amount, '0')::numeric) FILTER (WHERE topic = 'completed-deposit'), 0)::text AS sum_deposits_sats,
			COALESCE(SUM(COALESCE(amount, '0')::numeric) FILTER (WHERE topic = 'withdrawal-accept'), 0)::text AS sum_accepted_sats
		FROM sbtc_events
		WHERE canonical = true
	`.execute(db);
	// Single-row aggregate over zero rows still returns one all-zero row.
	const row = rows[0] as SbtcSummaryDbRow;

	const netFlow = BigInt(row.sum_deposits_sats) - BigInt(row.sum_accepted_sats);

	return {
		total_deposits: Number(row.total_deposits),
		total_withdrawals_requested: Number(row.total_withdrawals_requested),
		total_withdrawals_accepted: Number(row.total_withdrawals_accepted),
		total_withdrawals_rejected: Number(row.total_withdrawals_rejected),
		net_peg_flow_sats: netFlow.toString(),
		total_locked_sats: netFlow.toString(),
		// Circulating supply is authoritative on-chain, not reconstructed from
		// decoded event deltas (token mint/burn coverage is incomplete + the
		// withdrawal-request burn/mint pairing inflates burns). getSbtcSummaryResponse
		// fills this from the sbtc-token get-total-supply node read.
		sbtc_supply_sats: null,
	};
}

export async function getSbtcSummaryResponse(opts: {
	tip: IndexTip;
	readSbtcSummary?: SbtcSummaryReader;
	readSbtcSupply?: SbtcSupplyReader;
	decoderEnabled?: boolean;
}): Promise<SbtcSummaryResponse> {
	const note =
		(opts.decoderEnabled ?? isSbtcDecoderEnabled())
			? undefined
			: SBTC_DISABLED_NOTE;
	const reader = opts.readSbtcSummary ?? readSbtcSummary;
	const readSupply = opts.readSbtcSupply ?? readSbtcTokenSupply;
	const [summary, sbtcSupply] = await Promise.all([reader(), readSupply()]);
	return {
		summary: { ...summary, sbtc_supply_sats: sbtcSupply },
		tip: opts.tip,
		...(note ? { notes: note } : {}),
	};
}
