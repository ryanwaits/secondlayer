import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { encodeStreamsEventCursor } from "../../streams-events.ts";
import type { StreamsBulkBlockRange } from "../../streams-bulk/range.ts";

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
	partition_block_range: string;
};

type StxTransferDbRow = {
	block_height: string | number;
	timestamp: string | number;
	tx_id: string;
	tx_index: string | number;
	stream_event_index: string | number;
	data: unknown;
};

function dataRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function memoOrNull(value: unknown): string | null {
	const candidate = stringOrNull(value);
	if (!candidate) return null;
	return candidate;
}

export async function readCanonicalStxTransferRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<StxTransferRow[]> {
	const db = params.db ?? getSourceDb();
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
				AND e.block_height >= ${params.range.fromBlock}
				AND e.block_height <= ${params.range.toBlock}
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
		ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
	`.execute(db);

	return rows
		.map((row) => normalizeRow(row, params.partitionBlockRange))
		.filter((row): row is StxTransferRow => row !== null);
}

function normalizeRow(
	row: StxTransferDbRow,
	partitionBlockRange: string,
): StxTransferRow | null {
	const payload = dataRecord(row.data);
	const sender = stringOrNull(payload.sender);
	const recipient = stringOrNull(payload.recipient);
	const amount = stringOrNull(payload.amount);
	if (!sender || !recipient || !amount) return null;

	const blockHeight = Number(row.block_height);
	const eventIndex = Number(row.stream_event_index);
	return {
		cursor: encodeStreamsEventCursor({
			block_height: blockHeight,
			event_index: eventIndex,
		}),
		block_height: blockHeight,
		block_time: new Date(Number(row.timestamp) * 1000).toISOString(),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: eventIndex,
		sender,
		recipient,
		amount,
		memo: memoOrNull(payload.memo),
		partition_block_range: partitionBlockRange,
	};
}
