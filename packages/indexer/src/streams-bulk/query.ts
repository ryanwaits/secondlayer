import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	DB_TO_STREAMS_EVENT_TYPE,
	STREAMS_DB_EVENT_TYPES,
	encodeStreamsEventCursor,
	normalizeStreamsEventPayload,
	type StreamsEventType,
} from "../streams-events.ts";
import { stableJsonStringify } from "./json.ts";
import type { StreamsBulkBlockRange } from "./range.ts";

export type StreamsBulkEventRow = {
	cursor: string;
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: StreamsEventType;
	contract_id: string | null;
	ts: string;
	payload_json: string;
	partition_block_range: string;
};

type StreamsBulkDbRow = {
	block_height: string | number;
	index_block_hash: string;
	burn_block_height: string | number;
	burn_block_hash: string | null;
	timestamp: string | number;
	tx_id: string;
	tx_index: string | number;
	db_event_type: keyof typeof DB_TO_STREAMS_EVENT_TYPE;
	data: unknown;
	stream_event_index: string | number;
};

export async function readCanonicalStreamsBulkRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<StreamsBulkEventRow[]> {
	const db = params.db ?? getSourceDb();
	const dbEventTypes = sql.join(
		STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
	);
	const { rows } = await sql<StreamsBulkDbRow>`
		WITH ordered_events AS (
			SELECT
				e.block_height,
				b.hash AS index_block_hash,
				b.burn_block_height,
				b.burn_block_hash,
				b.timestamp,
				e.tx_id,
				t.tx_index,
				e.type AS db_event_type,
				e.data,
				(
					row_number() OVER (
						PARTITION BY e.block_height
						ORDER BY t.tx_index ASC, e.event_index ASC
					) - 1
				)::integer AS stream_event_index
			FROM events e
			INNER JOIN transactions t ON t.tx_id = e.tx_id
			INNER JOIN blocks b ON b.height = e.block_height
			WHERE b.canonical = true
				AND e.type IN (${dbEventTypes})
				AND e.block_height >= ${params.range.fromBlock}
				AND e.block_height <= ${params.range.toBlock}
		)
		SELECT *
		FROM ordered_events
		ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
	`.execute(db);

	return rows.map((row) => normalizeBulkRow(row, params.partitionBlockRange));
}

export async function countCanonicalStreamsBulkRows(params: {
	range: StreamsBulkBlockRange;
	db?: Kysely<Database>;
}): Promise<number> {
	const db = params.db ?? getSourceDb();
	const dbEventTypes = sql.join(
		STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
	);
	const { rows } = await sql<{ row_count: string | number }>`
		SELECT COUNT(*)::bigint AS row_count
		FROM events e
		INNER JOIN blocks b ON b.height = e.block_height
		WHERE b.canonical = true
			AND e.type IN (${dbEventTypes})
			AND e.block_height >= ${params.range.fromBlock}
			AND e.block_height <= ${params.range.toBlock}
	`.execute(db);
	return Number(rows[0]?.row_count ?? 0);
}

export async function getLatestCanonicalBlockHeight(
	db: Kysely<Database> = getSourceDb(),
): Promise<number | null> {
	const row = await db
		.selectFrom("blocks")
		.select((eb) => eb.fn.max<number>("height").as("height"))
		.where("canonical", "=", true)
		.executeTakeFirst();
	return row?.height === null || row?.height === undefined
		? null
		: Number(row.height);
}

function normalizeBulkRow(
	row: StreamsBulkDbRow,
	partitionBlockRange: string,
): StreamsBulkEventRow {
	const eventType = DB_TO_STREAMS_EVENT_TYPE[row.db_event_type];
	const blockHeight = Number(row.block_height);
	const eventIndex = Number(row.stream_event_index);
	const { payload, contract_id } = normalizeStreamsEventPayload(
		eventType,
		row.data,
	);

	return {
		cursor: encodeStreamsEventCursor({
			block_height: blockHeight,
			event_index: eventIndex,
		}),
		block_height: blockHeight,
		index_block_hash: row.index_block_hash,
		burn_block_height: Number(row.burn_block_height),
		burn_block_hash: row.burn_block_hash,
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: eventIndex,
		event_type: eventType,
		contract_id,
		ts: new Date(Number(row.timestamp) * 1000).toISOString(),
		payload_json: stableJsonStringify(payload),
		partition_block_range: partitionBlockRange,
	};
}
