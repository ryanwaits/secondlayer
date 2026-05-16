import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsBulkBlockRange } from "../../../streams-bulk/range.ts";

export type BnsMarketplaceEventParquetRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	action: string;
	bns_id: string;
	price_ustx: string | null;
	commission: string | null;
	partition_block_range: string;
};

type BnsMarketplaceEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	action: string;
	bns_id: string;
	price_ustx: string | null;
	commission: string | null;
};

export async function readCanonicalBnsMarketplaceEventRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<BnsMarketplaceEventParquetRow[]> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<BnsMarketplaceEventDbRow>`
		SELECT
			cursor,
			block_height,
			block_time,
			tx_id,
			tx_index,
			event_index,
			action,
			bns_id,
			price_ustx,
			commission
		FROM bns_marketplace_events
		WHERE block_height >= ${params.range.fromBlock}
			AND block_height <= ${params.range.toBlock}
		ORDER BY block_height ASC, tx_index ASC, event_index ASC
	`.execute(db);
	return rows.map((row) => normalize(row, params.partitionBlockRange));
}

function normalize(
	row: BnsMarketplaceEventDbRow,
	partitionBlockRange: string,
): BnsMarketplaceEventParquetRow {
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
		action: row.action,
		bns_id: row.bns_id,
		price_ustx: row.price_ustx,
		commission: row.commission,
		partition_block_range: partitionBlockRange,
	};
}
