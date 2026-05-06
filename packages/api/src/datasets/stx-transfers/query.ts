import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { ValidationError } from "@secondlayer/shared/errors";
import type { Kysely, RawBuilder } from "kysely";
import { decodeStreamsCursor } from "../../streams/cursor.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../../streams/tiers.ts";

export type StxTransferRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	sender: string;
	recipient: string;
	amount: string;
	memo: string | null;
};

export type StxTransfersQuery = {
	cursor?: { block_height: number; event_index: number };
	cursorRaw?: string;
	fromBlock: number;
	toBlock: number;
	limit: number;
	sender?: string;
	recipient?: string;
};

export type StxTransfersResponse = {
	events: StxTransferRow[];
	next_cursor: string | null;
	tip: { block_height: number };
};

type StxTransferDbRow = {
	block_height: string | number;
	timestamp: string | number;
	tx_id: string;
	tx_index: string | number;
	stream_event_index: string | number;
	data: unknown;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

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
	if (value === undefined) return DEFAULT_LIMIT;
	const parsed = parseNonNegativeInteger(value, "limit");
	return Math.min(MAX_LIMIT, Math.max(1, parsed));
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

function parseCursor(
	value: string,
): { block_height: number; event_index: number } {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}

export function parseStxTransfersQuery(
	query: URLSearchParams,
	tip: { block_height: number },
): StxTransfersQuery {
	const cursorRaw = query.get("cursor") ?? undefined;
	const fromBlockRaw = query.get("from_block") ?? undefined;
	const toBlockRaw = query.get("to_block") ?? undefined;

	if (cursorRaw && fromBlockRaw !== undefined) {
		throw new ValidationError("cursor and from_block are mutually exclusive");
	}

	const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;
	// Bound the default scan window to roughly one day of blocks so an
	// unfiltered request doesn't sweep the full event history. Callers that
	// need older data must pass `from_block` or a `cursor` explicitly.
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
		sender: parseFilter(query.get("sender") ?? undefined, "sender"),
		recipient: parseFilter(query.get("recipient") ?? undefined, "recipient"),
	};
}

function dataRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeRow(row: StxTransferDbRow): StxTransferRow | null {
	const payload = dataRecord(row.data);
	const sender = stringOrNull(payload.sender);
	const recipient = stringOrNull(payload.recipient);
	const amount = stringOrNull(payload.amount);
	if (!sender || !recipient || !amount) return null;

	const blockHeight = Number(row.block_height);
	const eventIndex = Number(row.stream_event_index);
	return {
		cursor: `${blockHeight}:${eventIndex}`,
		block_height: blockHeight,
		block_time: new Date(Number(row.timestamp) * 1000).toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: eventIndex,
		sender,
		recipient,
		amount,
		memo: stringOrNull(payload.memo),
	};
}

export type ReadStxTransfersParams = {
	after?: { block_height: number; event_index: number };
	fromBlock: number;
	toBlock: number;
	limit: number;
	sender?: string;
	recipient?: string;
	db?: Kysely<Database>;
};

export type ReadStxTransfersResult = {
	events: StxTransferRow[];
	next_cursor: string | null;
};

export type StxTransfersReader = (
	params: ReadStxTransfersParams,
) => Promise<ReadStxTransfersResult>;

export async function readStxTransfers(
	params: ReadStxTransfersParams,
): Promise<ReadStxTransfersResult> {
	if (params.toBlock < params.fromBlock) {
		return { events: [], next_cursor: null };
	}
	const db = params.db ?? getSourceDb();

	const senderPredicate: RawBuilder<unknown> = params.sender
		? sql`AND e.data->>'sender' = ${params.sender}`
		: sql``;
	const recipientPredicate: RawBuilder<unknown> = params.recipient
		? sql`AND e.data->>'recipient' = ${params.recipient}`
		: sql``;

	const cursorPredicate: RawBuilder<unknown> = params.after
		? sql`
				AND (
					block_height > ${params.after.block_height}
					OR (
						block_height = ${params.after.block_height}
						AND stream_event_index > ${params.after.event_index}
					)
				)
			`
		: sql``;

	const { rows } = await sql<StxTransferDbRow>`
		WITH ordered_events AS (
			SELECT
				e.block_height,
				b.timestamp,
				e.tx_id,
				t.tx_index,
				e.data,
				(
					row_number() OVER (
						PARTITION BY e.block_height
						ORDER BY t.tx_index ASC, e.event_index ASC
					) - 1
				)::integer AS stream_event_index,
				e.type AS db_event_type
			FROM events e
			INNER JOIN transactions t ON t.tx_id = e.tx_id
			INNER JOIN blocks b ON b.height = e.block_height
			WHERE b.canonical = true
				AND e.type IN (
					'stx_transfer_event','stx_mint_event','stx_burn_event','stx_lock_event',
					'ft_transfer_event','ft_mint_event','ft_burn_event',
					'nft_transfer_event','nft_mint_event','nft_burn_event',
					'smart_contract_event'
				)
				AND e.block_height >= ${params.fromBlock}
				AND e.block_height <= ${params.toBlock}
				${senderPredicate}
				${recipientPredicate}
		)
		SELECT
			block_height,
			timestamp,
			tx_id,
			tx_index,
			stream_event_index,
			data
		FROM ordered_events
		WHERE db_event_type = 'stx_transfer_event'
			${cursorPredicate}
		ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
		LIMIT ${params.limit + 1}
	`.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows
		.map(normalizeRow)
		.filter((row): row is StxTransferRow => row !== null);
	const lastEvent = events.at(-1);

	return {
		events,
		next_cursor: lastEvent
			? `${lastEvent.block_height}:${lastEvent.event_index}`
			: null,
	};
}

export async function getStxTransfersResponse(opts: {
	query: URLSearchParams;
	tip: { block_height: number };
	readTransfers?: StxTransfersReader;
}): Promise<StxTransfersResponse> {
	const parsed = parseStxTransfersQuery(opts.query, opts.tip);
	const readTransfers = opts.readTransfers ?? readStxTransfers;
	const result = await readTransfers({
		after: parsed.cursor,
		fromBlock: parsed.fromBlock,
		toBlock: parsed.toBlock,
		limit: parsed.limit,
		sender: parsed.sender,
		recipient: parsed.recipient,
	});
	return {
		events: result.events,
		next_cursor: result.next_cursor,
		tip: opts.tip,
	};
}
