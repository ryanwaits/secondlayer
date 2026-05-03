import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export const STREAMS_EVENT_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"print",
] as const;

export type StreamsEventType = (typeof STREAMS_EVENT_TYPES)[number];

const STREAMS_DB_EVENT_TYPES = [
	"stx_transfer_event",
	"stx_mint_event",
	"stx_burn_event",
	"stx_lock_event",
	"ft_transfer_event",
	"ft_mint_event",
	"ft_burn_event",
	"nft_transfer_event",
	"nft_mint_event",
	"nft_burn_event",
	"smart_contract_event",
] as const;

const DB_TO_STREAMS_EVENT_TYPE: Record<
	(typeof STREAMS_DB_EVENT_TYPES)[number],
	StreamsEventType
> = {
	stx_transfer_event: "stx_transfer",
	stx_mint_event: "stx_mint",
	stx_burn_event: "stx_burn",
	stx_lock_event: "stx_lock",
	ft_transfer_event: "ft_transfer",
	ft_mint_event: "ft_mint",
	ft_burn_event: "ft_burn",
	nft_transfer_event: "nft_transfer",
	nft_mint_event: "nft_mint",
	nft_burn_event: "nft_burn",
	smart_contract_event: "print",
};

const STREAMS_TO_DB_EVENT_TYPE: Record<
	StreamsEventType,
	(typeof STREAMS_DB_EVENT_TYPES)[number]
> = {
	stx_transfer: "stx_transfer_event",
	stx_mint: "stx_mint_event",
	stx_burn: "stx_burn_event",
	stx_lock: "stx_lock_event",
	ft_transfer: "ft_transfer_event",
	ft_mint: "ft_mint_event",
	ft_burn: "ft_burn_event",
	nft_transfer: "nft_transfer_event",
	nft_mint: "nft_mint_event",
	nft_burn: "nft_burn_event",
	print: "smart_contract_event",
};

export type StreamsEventCursor = {
	block_height: number;
	event_index: number;
};

export type StreamsEvent = {
	cursor: string;
	block_height: number;
	index_block_hash: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: StreamsEventType;
	contract_id: string | null;
	payload: Record<string, unknown>;
	ts: string;
};

export type ReadCanonicalStreamsEventsParams = {
	after?: StreamsEventCursor;
	fromHeight?: number;
	toHeight: number;
	types?: readonly StreamsEventType[];
	limit: number;
	db?: Kysely<Database>;
};

export type ReadCanonicalStreamsEventsResult = {
	events: StreamsEvent[];
	next_cursor: string | null;
};

type StreamsEventRow = {
	block_height: string | number;
	index_block_hash: string;
	burn_block_height: string | number;
	timestamp: string | number;
	tx_id: string;
	tx_index: string | number;
	source_event_index: string | number;
	db_event_type: (typeof STREAMS_DB_EVENT_TYPES)[number];
	data: unknown;
	stream_event_index: string | number;
};

export function encodeStreamsEventCursor(cursor: StreamsEventCursor): string {
	return `${cursor.block_height}:${cursor.event_index}`;
}

function dataRecord(data: unknown): Record<string, unknown> {
	return data && typeof data === "object" && !Array.isArray(data)
		? (data as Record<string, unknown>)
		: {};
}

function contractIdFromAssetIdentifier(value: unknown): string | null {
	return typeof value === "string" ? (value.split("::")[0] ?? null) : null;
}

function withoutContractIdentifier(
	payload: Record<string, unknown>,
): Record<string, unknown> {
	const rest: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (key !== "contract_identifier") rest[key] = value;
	}
	return rest;
}

function normalizePayload(
	eventType: StreamsEventType,
	data: unknown,
): { payload: Record<string, unknown>; contract_id: string | null } {
	const payload = dataRecord(data);
	if (eventType === "print") {
		const contractId =
			typeof payload.contract_identifier === "string"
				? payload.contract_identifier
				: typeof payload.contract_id === "string"
					? payload.contract_id
					: null;
		const rest = withoutContractIdentifier(payload);
		return {
			payload: contractId ? { ...rest, contract_id: contractId } : rest,
			contract_id: contractId,
		};
	}

	if (
		eventType === "ft_transfer" ||
		eventType === "ft_mint" ||
		eventType === "ft_burn" ||
		eventType === "nft_transfer" ||
		eventType === "nft_mint" ||
		eventType === "nft_burn"
	) {
		return {
			payload,
			contract_id: contractIdFromAssetIdentifier(payload.asset_identifier),
		};
	}

	return { payload, contract_id: null };
}

function normalizeRow(row: StreamsEventRow): StreamsEvent {
	const eventType = DB_TO_STREAMS_EVENT_TYPE[row.db_event_type];
	const eventIndex = Number(row.stream_event_index);
	const blockHeight = Number(row.block_height);
	const { payload, contract_id } = normalizePayload(eventType, row.data);

	return {
		cursor: encodeStreamsEventCursor({
			block_height: blockHeight,
			event_index: eventIndex,
		}),
		block_height: blockHeight,
		index_block_hash: row.index_block_hash,
		burn_block_height: Number(row.burn_block_height),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: eventIndex,
		event_type: eventType,
		contract_id,
		payload,
		ts: new Date(Number(row.timestamp) * 1000).toISOString(),
	};
}

export async function readCanonicalStreamsEvents(
	params: ReadCanonicalStreamsEventsParams,
): Promise<ReadCanonicalStreamsEventsResult> {
	const db = params.db ?? getSourceDb();
	const lowerHeight = params.after?.block_height ?? params.fromHeight ?? 0;
	if (params.toHeight < lowerHeight) {
		return { events: [], next_cursor: null };
	}

	if (params.types?.length === 0) {
		return { events: [], next_cursor: null };
	}

	const allDbEventTypes = sql.join(
		STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
	);
	const selectedDbEventTypes = sql.join(
		(params.types ?? STREAMS_EVENT_TYPES).map(
			(eventType) => sql`${STREAMS_TO_DB_EVENT_TYPE[eventType]}`,
		),
	);
	const cursorFilter = params.after
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

	const { rows } = await sql<StreamsEventRow>`
    WITH ordered_events AS (
      SELECT
        e.block_height,
        b.hash AS index_block_hash,
        b.burn_block_height,
        b.timestamp,
        e.tx_id,
        t.tx_index,
        e.event_index AS source_event_index,
        e.type AS db_event_type,
        e.data,
        (
          SELECT COUNT(*)::integer - 1
          FROM events e2
          INNER JOIN transactions t2 ON t2.tx_id = e2.tx_id
          WHERE e2.block_height = e.block_height
            AND e2.type IN (${allDbEventTypes})
            AND (
              t2.tx_index < t.tx_index
              OR (
                t2.tx_index = t.tx_index
                AND e2.event_index <= e.event_index
              )
            )
        ) AS stream_event_index
      FROM events e
      INNER JOIN transactions t ON t.tx_id = e.tx_id
      INNER JOIN blocks b ON b.height = e.block_height
      WHERE b.canonical = true
        AND e.type IN (${selectedDbEventTypes})
        AND e.block_height >= ${lowerHeight}
        AND e.block_height <= ${params.toHeight}
    )
    SELECT *
    FROM ordered_events
    WHERE true
      ${cursorFilter}
    ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
    LIMIT ${params.limit + 1}
  `.execute(db);

	const pageRows = rows.slice(0, params.limit);
	const events = pageRows.map(normalizeRow);
	const lastScannedRow = pageRows.at(-1);
	const next_cursor = lastScannedRow
		? encodeStreamsEventCursor({
				block_height: Number(lastScannedRow.block_height),
				event_index: Number(lastScannedRow.stream_event_index),
			})
		: null;

	return { events, next_cursor };
}
