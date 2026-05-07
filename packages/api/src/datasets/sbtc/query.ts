import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type {
	SbtcEventTopic,
	SbtcTokenEventType,
} from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { decodeStreamsCursor } from "../../streams/cursor.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../../streams/tiers.ts";

// ── Shared parsing helpers ─────────────────────────────────────────

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

function parseLimit(value: string | undefined): number {
	if (value === undefined) return 200;
	const parsed = parseNonNegativeInteger(value, "limit");
	return Math.min(1000, Math.max(1, parsed));
}

function parseFilter(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (value.length === 0) {
		throw new ValidationError(`${name} must not be empty`);
	}
	return value;
}

function parseCursor(value: string): {
	block_height: number;
	event_index: number;
} {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}

const VALID_REGISTRY_TOPICS = new Set<SbtcEventTopic>([
	"completed-deposit",
	"withdrawal-create",
	"withdrawal-accept",
	"withdrawal-reject",
	"key-rotation",
	"update-protocol-contract",
]);

const VALID_TOKEN_TYPES = new Set<SbtcTokenEventType>([
	"transfer",
	"mint",
	"burn",
]);

function parseTopic(value: string | undefined): SbtcEventTopic | undefined {
	if (value === undefined) return undefined;
	if (!VALID_REGISTRY_TOPICS.has(value as SbtcEventTopic)) {
		throw new ValidationError(`invalid topic: ${value}`);
	}
	return value as SbtcEventTopic;
}

function parseTokenEventType(
	value: string | undefined,
): SbtcTokenEventType | undefined {
	if (value === undefined) return undefined;
	if (!VALID_TOKEN_TYPES.has(value as SbtcTokenEventType)) {
		throw new ValidationError(`invalid event_type: ${value}`);
	}
	return value as SbtcTokenEventType;
}

function bumpCursor(blockHeight: number, eventIndex: number): RawBuilder<unknown> {
	return sql`
		(
			block_height > ${blockHeight}
			OR (
				block_height = ${blockHeight}
				AND event_index > ${eventIndex}
			)
		)
	`;
}

// ── /v1/datasets/sbtc/events ───────────────────────────────────────

export type SbtcEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
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
	block_height_at_request: number | null;
	governance_contract_type: number | null;
	governance_new_contract: string | null;
	signer_aggregate_pubkey: string | null;
	signer_threshold: number | null;
	signer_address: string | null;
	signer_keys_count: number | null;
};

export type SbtcEventsQuery = {
	cursor?: { block_height: number; event_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	topic?: SbtcEventTopic;
	requestId?: number;
	bitcoinTxid?: string;
	sender?: string;
};

export function parseSbtcEventsQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): SbtcEventsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}

	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const defaultFromBlock = Math.max(0, tip.block_height - STREAMS_BLOCKS_PER_DAY);
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: cursorRaw !== undefined
				? 0
				: defaultFromBlock;
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.block_height,
				)
			: tip.block_height;

	const requestIdRaw = query.get("request_id");
	const requestId =
		requestIdRaw !== null
			? parseNonNegativeInteger(requestIdRaw, "request_id")
			: undefined;

	return {
		cursor,
		cursorRaw,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
		topic: parseTopic(query.get("topic") ?? undefined),
		requestId,
		bitcoinTxid: parseFilter(
			query.get("bitcoin_txid") ?? undefined,
			"bitcoin_txid",
		),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
	};
}

type SbtcEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	topic: string;
	request_id: string | number | null;
	amount: string | null;
	sender: string | null;
	recipient_btc_version: string | number | null;
	recipient_btc_hashbytes: string | null;
	bitcoin_txid: string | null;
	output_index: string | number | null;
	sweep_txid: string | null;
	burn_hash: string | null;
	burn_height: string | number | null;
	signer_bitmap: string | null;
	max_fee: string | null;
	fee: string | null;
	block_height_at_request: string | number | null;
	governance_contract_type: string | number | null;
	governance_new_contract: string | null;
	signer_aggregate_pubkey: string | null;
	signer_threshold: string | number | null;
	signer_address: string | null;
	signer_keys_count: string | number | null;
};

function num(value: string | number | null): number | null {
	if (value === null) return null;
	return Number(value);
}

function normalizeSbtcRow(row: SbtcEventDbRow): SbtcEventRow {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: row.block_time.toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		topic: row.topic as SbtcEventTopic,
		request_id: num(row.request_id),
		amount: row.amount,
		sender: row.sender,
		recipient_btc_version: num(row.recipient_btc_version),
		recipient_btc_hashbytes: row.recipient_btc_hashbytes,
		bitcoin_txid: row.bitcoin_txid,
		output_index: num(row.output_index),
		sweep_txid: row.sweep_txid,
		burn_hash: row.burn_hash,
		burn_height: num(row.burn_height),
		signer_bitmap: row.signer_bitmap,
		max_fee: row.max_fee,
		fee: row.fee,
		block_height_at_request: num(row.block_height_at_request),
		governance_contract_type: num(row.governance_contract_type),
		governance_new_contract: row.governance_new_contract,
		signer_aggregate_pubkey: row.signer_aggregate_pubkey,
		signer_threshold: num(row.signer_threshold),
		signer_address: row.signer_address,
		signer_keys_count: num(row.signer_keys_count),
	};
}

export type ReadSbtcEventsParams = {
	after?: { block_height: number; event_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	topic?: SbtcEventTopic;
	requestId?: number;
	bitcoinTxid?: string;
	sender?: string;
	db?: Kysely<Database>;
};

export type ReadSbtcEventsResult = {
	events: SbtcEventRow[];
	next_cursor: string | null;
};

export type SbtcEventsReader = (
	params: ReadSbtcEventsParams,
) => Promise<ReadSbtcEventsResult>;

export async function readSbtcEvents(
	params: ReadSbtcEventsParams,
): Promise<ReadSbtcEventsResult> {
	if (params.toBlock < params.fromBlock) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();

	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromBlock}`,
		sql`block_height <= ${params.toBlock}`,
	];
	if (params.topic) predicates.push(sql`topic = ${params.topic}`);
	if (params.requestId !== undefined) {
		predicates.push(sql`request_id = ${params.requestId}`);
	}
	if (params.bitcoinTxid) {
		predicates.push(sql`bitcoin_txid = ${params.bitcoinTxid}`);
	}
	if (params.sender) predicates.push(sql`sender = ${params.sender}`);
	if (params.after) {
		predicates.push(
			bumpCursor(params.after.block_height, params.after.event_index),
		);
	}

	const { rows } = await sql<SbtcEventDbRow>`
		SELECT
			cursor, block_height, block_time, tx_id, tx_index, event_index, topic,
			request_id, amount, sender, recipient_btc_version, recipient_btc_hashbytes,
			bitcoin_txid, output_index, sweep_txid, burn_hash, burn_height,
			signer_bitmap, max_fee, fee, block_height_at_request,
			governance_contract_type, governance_new_contract,
			signer_aggregate_pubkey, signer_threshold, signer_address, signer_keys_count
		FROM sbtc_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeSbtcRow);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last ? `${last.block_height}:${last.event_index}` : null,
	};
}

export async function getSbtcEventsResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	readEvents?: SbtcEventsReader;
}): Promise<{
	events: SbtcEventRow[];
	next_cursor: string | null;
	tip: { block_height: number };
}> {
	const parsed = parseSbtcEventsQuery(opts.query, opts.tip);
	const reader = opts.readEvents ?? readSbtcEvents;
	const result = await reader({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		topic: parsed.topic,
		requestId: parsed.requestId,
		bitcoinTxid: parsed.bitcoinTxid,
		sender: parsed.sender,
	});
	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}

// ── /v1/datasets/sbtc/token-events ─────────────────────────────────

export type SbtcTokenEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: SbtcTokenEventType;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
};

export type SbtcTokenEventsQuery = {
	cursor?: { block_height: number; event_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	eventType?: SbtcTokenEventType;
	sender?: string;
	recipient?: string;
};

export function parseSbtcTokenEventsQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): SbtcTokenEventsQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;
	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}

	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	const defaultFromBlock = Math.max(0, tip.block_height - STREAMS_BLOCKS_PER_DAY);
	const fromBlock =
		fromBlockRaw !== undefined
			? parseNonNegativeInteger(fromBlockRaw, "from_block")
			: cursorRaw !== undefined
				? 0
				: defaultFromBlock;
	const toBlock =
		toBlockRaw !== undefined
			? Math.min(
					parseNonNegativeInteger(toBlockRaw, "to_block"),
					tip.block_height,
				)
			: tip.block_height;

	return {
		cursor,
		cursorRaw,
		fromBlock,
		toBlock,
		limit: parseLimit(query.get("limit") ?? undefined),
		eventType: parseTokenEventType(query.get("event_type") ?? undefined),
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		recipient: parseFilter(query.get("recipient") ?? undefined, "recipient"),
	};
}

type SbtcTokenEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	event_type: string;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
};

function normalizeTokenRow(row: SbtcTokenEventDbRow): SbtcTokenEventRow {
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: row.block_time.toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		event_type: row.event_type as SbtcTokenEventType,
		sender: row.sender,
		recipient: row.recipient,
		amount: row.amount,
		memo: row.memo,
	};
}

export type ReadSbtcTokenEventsParams = {
	after?: { block_height: number; event_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	eventType?: SbtcTokenEventType;
	sender?: string;
	recipient?: string;
	db?: Kysely<Database>;
};

export type ReadSbtcTokenEventsResult = {
	events: SbtcTokenEventRow[];
	next_cursor: string | null;
};

export type SbtcTokenEventsReader = (
	params: ReadSbtcTokenEventsParams,
) => Promise<ReadSbtcTokenEventsResult>;

export async function readSbtcTokenEvents(
	params: ReadSbtcTokenEventsParams,
): Promise<ReadSbtcTokenEventsResult> {
	if (params.toBlock < params.fromBlock) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();

	const predicates: RawBuilder<unknown>[] = [
		sql`canonical = true`,
		sql`block_height >= ${params.fromBlock}`,
		sql`block_height <= ${params.toBlock}`,
	];
	if (params.eventType) predicates.push(sql`event_type = ${params.eventType}`);
	if (params.sender) predicates.push(sql`sender = ${params.sender}`);
	if (params.recipient) predicates.push(sql`recipient = ${params.recipient}`);
	if (params.after) {
		predicates.push(
			bumpCursor(params.after.block_height, params.after.event_index),
		);
	}

	const { rows } = await sql<SbtcTokenEventDbRow>`
		SELECT
			cursor, block_height, block_time, tx_id, tx_index, event_index,
			event_type, sender, recipient, amount, memo
		FROM sbtc_token_events
		WHERE ${sql.join(predicates, sql` AND `)}
		ORDER BY block_height ASC, event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeTokenRow);
	const last = events.at(-1);
	return {
		events,
		next_cursor: last ? `${last.block_height}:${last.event_index}` : null,
	};
}

export async function getSbtcTokenEventsResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	readEvents?: SbtcTokenEventsReader;
}): Promise<{
	events: SbtcTokenEventRow[];
	next_cursor: string | null;
	tip: { block_height: number };
}> {
	const parsed = parseSbtcTokenEventsQuery(opts.query, opts.tip);
	const reader = opts.readEvents ?? readSbtcTokenEvents;
	const result = await reader({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		eventType: parsed.eventType,
		sender: parsed.sender,
		recipient: parsed.recipient,
	});
	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
