import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsBulkBlockRange } from "../../../streams-bulk/range.ts";

export type SbtcTokenEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: string;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
	partition_block_range: string;
};

type SbtcTokenEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	event_type: string;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
};

export async function readCanonicalSbtcTokenEventRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<SbtcTokenEventRow[]> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<SbtcTokenEventDbRow>`
		SELECT
			cursor,
			block_height,
			block_time,
			tx_id,
			tx_index,
			event_index,
			event_type,
			sender,
			recipient,
			amount,
			memo
		FROM sbtc_token_events
		WHERE canonical = true
			AND block_height >= ${params.range.fromBlock}
			AND block_height <= ${params.range.toBlock}
		ORDER BY block_height ASC, tx_index ASC, event_index ASC
	`.execute(db);

	return rows.map((row) => normalizeRow(row, params.partitionBlockRange));
}

function normalizeRow(
	row: SbtcTokenEventDbRow,
	partitionBlockRange: string,
): SbtcTokenEventRow {
	const blockTime =
		row.block_time instanceof Date
			? row.block_time.toISOString()
			: new Date(row.block_time).toISOString();
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: blockTime,
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		event_type: row.event_type,
		sender: row.sender,
		recipient: row.recipient,
		amount: row.amount,
		memo: row.memo,
		partition_block_range: partitionBlockRange,
	};
}
