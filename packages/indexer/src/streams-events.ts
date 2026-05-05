import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely, RawBuilder } from "kysely";

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
	contractId?: string;
	limit: number;
	db?: Kysely<Database>;
};

export type ReadCanonicalStreamsEventsResult = {
	events: StreamsEvent[];
	next_cursor: string | null;
};

export type ReadStreamsEventsByTxIdParams = {
	txId: string;
	limit?: number;
	db?: Kysely<Database>;
};

export type ReadStreamsBlockEventsParams = {
	blockHeight?: number;
	indexBlockHash?: string;
	limit?: number;
	db?: Kysely<Database>;
};

export type ReadStreamsEventsListResult = {
	events: StreamsEvent[];
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
	const contractPredicate = contractIdPredicate(params.contractId);
	const rows = params.after
		? await readCanonicalStreamsEventsAfterCursor({
				db,
				after: params.after,
				toHeight: params.toHeight,
				limit: params.limit,
				allDbEventTypes,
				selectedDbEventTypes,
				contractPredicate,
			})
		: await readCanonicalStreamsEventsFromHeight({
				db,
				fromHeight: lowerHeight,
				toHeight: params.toHeight,
				limit: params.limit,
				allDbEventTypes,
				selectedDbEventTypes,
				contractPredicate,
			});

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

function contractIdPredicate(
	contractId: string | undefined,
): RawBuilder<unknown> {
	if (!contractId) return sql``;
	return sql`
		AND (
			(
				e.type = 'smart_contract_event'
				AND (
					e.data->>'contract_identifier' = ${contractId}
					OR e.data->>'contract_id' = ${contractId}
				)
			)
			OR (
				e.type IN (
					'ft_transfer_event',
					'ft_mint_event',
					'ft_burn_event',
					'nft_transfer_event',
					'nft_mint_event',
					'nft_burn_event'
				)
				AND split_part(e.data->>'asset_identifier', '::', 1) = ${contractId}
			)
		)
	`;
}

export async function readCanonicalStreamsEventsByTxId(
	params: ReadStreamsEventsByTxIdParams,
): Promise<ReadStreamsEventsListResult> {
	const db = params.db ?? getSourceDb();
	const allDbEventTypes = sql.join(
		STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
	);
	const { rows } = await sql<StreamsEventRow>`
		WITH candidate_events AS (
			SELECT
				e.block_height,
				b.hash AS index_block_hash,
				b.burn_block_height,
				b.timestamp,
				e.tx_id,
				t.tx_index,
				e.event_index AS source_event_index,
				e.type AS db_event_type,
				e.data
			FROM events e
			INNER JOIN transactions t ON t.tx_id = e.tx_id
			INNER JOIN blocks b ON b.height = e.block_height
			WHERE b.canonical = true
				AND e.type IN (${allDbEventTypes})
				AND e.tx_id = ${params.txId}
			ORDER BY e.block_height ASC, t.tx_index ASC, e.event_index ASC
			LIMIT ${params.limit ?? 1000}
		),
		ordered_events AS (
			SELECT
				c.block_height,
				c.index_block_hash,
				c.burn_block_height,
				c.timestamp,
				c.tx_id,
				c.tx_index,
				c.source_event_index,
				c.db_event_type,
				c.data,
				(
					SELECT COUNT(*)::integer - 1
					FROM events e2
					INNER JOIN transactions t2 ON t2.tx_id = e2.tx_id
					WHERE e2.block_height = c.block_height
						AND e2.type IN (${allDbEventTypes})
						AND (
							t2.tx_index < c.tx_index
							OR (
								t2.tx_index = c.tx_index
								AND e2.event_index <= c.source_event_index
							)
						)
				) AS stream_event_index
			FROM candidate_events c
		)
		SELECT *
		FROM ordered_events
		ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
	`.execute(db);

	return { events: rows.map(normalizeRow) };
}

export async function readCanonicalStreamsBlockEvents(
	params: ReadStreamsBlockEventsParams,
): Promise<ReadStreamsEventsListResult> {
	const db = params.db ?? getSourceDb();
	if (params.blockHeight === undefined && !params.indexBlockHash) {
		return { events: [] };
	}
	const allDbEventTypes = sql.join(
		STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
	);
	const blockPredicate =
		params.blockHeight !== undefined
			? sql`b.height = ${params.blockHeight}`
			: sql`b.hash = ${params.indexBlockHash}`;
	const { rows } = await sql<StreamsEventRow>`
		WITH candidate_events AS (
			SELECT
				e.block_height,
				b.hash AS index_block_hash,
				b.burn_block_height,
				b.timestamp,
				e.tx_id,
				t.tx_index,
				e.event_index AS source_event_index,
				e.type AS db_event_type,
				e.data
			FROM events e
			INNER JOIN transactions t ON t.tx_id = e.tx_id
			INNER JOIN blocks b ON b.height = e.block_height
			WHERE b.canonical = true
				AND e.type IN (${allDbEventTypes})
				AND ${blockPredicate}
			ORDER BY e.block_height ASC, t.tx_index ASC, e.event_index ASC
			LIMIT ${params.limit ?? 1000}
		),
		ordered_events AS (
			SELECT
				c.block_height,
				c.index_block_hash,
				c.burn_block_height,
				c.timestamp,
				c.tx_id,
				c.tx_index,
				c.source_event_index,
				c.db_event_type,
				c.data,
				(
					SELECT COUNT(*)::integer - 1
					FROM events e2
					INNER JOIN transactions t2 ON t2.tx_id = e2.tx_id
					WHERE e2.block_height = c.block_height
						AND e2.type IN (${allDbEventTypes})
						AND (
							t2.tx_index < c.tx_index
							OR (
								t2.tx_index = c.tx_index
								AND e2.event_index <= c.source_event_index
							)
						)
				) AS stream_event_index
			FROM candidate_events c
		)
		SELECT *
		FROM ordered_events
		ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
	`.execute(db);

	return { events: rows.map(normalizeRow) };
}

async function readCanonicalStreamsEventsFromHeight(opts: {
	db: Kysely<Database>;
	fromHeight: number;
	toHeight: number;
	limit: number;
	allDbEventTypes: RawBuilder<unknown>;
	selectedDbEventTypes: RawBuilder<unknown>;
	contractPredicate: RawBuilder<unknown>;
}): Promise<StreamsEventRow[]> {
	const { rows } = await sql<StreamsEventRow>`
    WITH candidate_events AS (
      SELECT
        e.block_height,
        b.hash AS index_block_hash,
        b.burn_block_height,
        b.timestamp,
        e.tx_id,
        t.tx_index,
        e.event_index AS source_event_index,
        e.type AS db_event_type,
        e.data
      FROM events e
      INNER JOIN transactions t ON t.tx_id = e.tx_id
      INNER JOIN blocks b ON b.height = e.block_height
      WHERE b.canonical = true
        AND e.type IN (${opts.selectedDbEventTypes})
        ${opts.contractPredicate}
        AND e.block_height >= ${opts.fromHeight}
        AND e.block_height <= ${opts.toHeight}
      ORDER BY e.block_height ASC, t.tx_index ASC, e.event_index ASC
      LIMIT ${opts.limit + 1}
    ),
    ordered_events AS (
      SELECT
        c.block_height,
        c.index_block_hash,
        c.burn_block_height,
        c.timestamp,
        c.tx_id,
        c.tx_index,
        c.source_event_index,
        c.db_event_type,
        c.data,
        (
          SELECT COUNT(*)::integer - 1
          FROM events e2
          INNER JOIN transactions t2 ON t2.tx_id = e2.tx_id
          WHERE e2.block_height = c.block_height
            AND e2.type IN (${opts.allDbEventTypes})
            AND (
              t2.tx_index < c.tx_index
              OR (
                t2.tx_index = c.tx_index
                AND e2.event_index <= c.source_event_index
              )
            )
        ) AS stream_event_index
      FROM candidate_events c
    )
    SELECT *
    FROM ordered_events
    ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
    LIMIT ${opts.limit + 1}
  `.execute(opts.db);

	return rows;
}

async function readCanonicalStreamsEventsAfterCursor(opts: {
	db: Kysely<Database>;
	after: StreamsEventCursor;
	toHeight: number;
	limit: number;
	allDbEventTypes: RawBuilder<unknown>;
	selectedDbEventTypes: RawBuilder<unknown>;
	contractPredicate: RawBuilder<unknown>;
}): Promise<StreamsEventRow[]> {
	const { rows } = await sql<StreamsEventRow>`
    WITH same_block_events AS (
      SELECT
        e.block_height,
        b.hash AS index_block_hash,
        b.burn_block_height,
        b.timestamp,
        e.tx_id,
        t.tx_index,
        e.event_index AS source_event_index,
        e.type AS db_event_type,
        e.data
      FROM events e
      INNER JOIN transactions t ON t.tx_id = e.tx_id
      INNER JOIN blocks b ON b.height = e.block_height
      WHERE b.canonical = true
        AND e.type IN (${opts.selectedDbEventTypes})
        ${opts.contractPredicate}
        AND e.block_height = ${opts.after.block_height}
        AND e.block_height <= ${opts.toHeight}
    ),
    future_events AS (
      SELECT
        e.block_height,
        b.hash AS index_block_hash,
        b.burn_block_height,
        b.timestamp,
        e.tx_id,
        t.tx_index,
        e.event_index AS source_event_index,
        e.type AS db_event_type,
        e.data
      FROM events e
      INNER JOIN transactions t ON t.tx_id = e.tx_id
      INNER JOIN blocks b ON b.height = e.block_height
      WHERE b.canonical = true
        AND e.type IN (${opts.selectedDbEventTypes})
        ${opts.contractPredicate}
        AND e.block_height > ${opts.after.block_height}
        AND e.block_height <= ${opts.toHeight}
      ORDER BY e.block_height ASC, t.tx_index ASC, e.event_index ASC
      LIMIT ${opts.limit + 1}
    ),
    candidate_events AS (
      SELECT * FROM same_block_events
      UNION ALL
      SELECT * FROM future_events
    ),
    ordered_events AS (
      SELECT
        c.block_height,
        c.index_block_hash,
        c.burn_block_height,
        c.timestamp,
        c.tx_id,
        c.tx_index,
        c.source_event_index,
        c.db_event_type,
        c.data,
        (
          SELECT COUNT(*)::integer - 1
          FROM events e2
          INNER JOIN transactions t2 ON t2.tx_id = e2.tx_id
          WHERE e2.block_height = c.block_height
            AND e2.type IN (${opts.allDbEventTypes})
            AND (
              t2.tx_index < c.tx_index
              OR (
                t2.tx_index = c.tx_index
                AND e2.event_index <= c.source_event_index
              )
            )
        ) AS stream_event_index
      FROM candidate_events c
    )
    SELECT *
    FROM ordered_events
    WHERE
      block_height > ${opts.after.block_height}
      OR (
        block_height = ${opts.after.block_height}
        AND stream_event_index > ${opts.after.event_index}
      )
    ORDER BY block_height ASC, tx_index ASC, stream_event_index ASC
    LIMIT ${opts.limit + 1}
  `.execute(opts.db);

	return rows;
}
