import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsBulkBlockRange } from "../../../streams-bulk/range.ts";
import { blockTimeToIso, nullableInt } from "../../_shared/row.ts";

export type BnsNamespaceEventParquetRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	status: string;
	namespace: string;
	manager: string | null;
	manager_frozen: boolean | null;
	manager_transfers_disabled: boolean | null;
	price_function: string | null;
	price_frozen: boolean | null;
	lifetime: number | null;
	revealed_at: number | null;
	launched_at: number | null;
	partition_block_range: string;
};

type BnsNamespaceEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	status: string;
	namespace: string;
	manager: string | null;
	manager_frozen: boolean | null;
	manager_transfers_disabled: boolean | null;
	price_function: string | null;
	price_frozen: boolean | null;
	lifetime: string | number | null;
	revealed_at: string | number | null;
	launched_at: string | number | null;
};

export async function readCanonicalBnsNamespaceEventRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<BnsNamespaceEventParquetRow[]> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<BnsNamespaceEventDbRow>`
		SELECT
			cursor,
			block_height,
			block_time,
			tx_id,
			tx_index,
			event_index,
			status,
			namespace,
			manager,
			manager_frozen,
			manager_transfers_disabled,
			price_function,
			price_frozen,
			lifetime,
			revealed_at,
			launched_at
		FROM bns_namespace_events
		WHERE canonical = true
			AND block_height >= ${params.range.fromBlock}
			AND block_height <= ${params.range.toBlock}
		ORDER BY block_height ASC, tx_index ASC, event_index ASC
	`.execute(db);
	return rows.map((row) => normalize(row, params.partitionBlockRange));
}

function normalize(
	row: BnsNamespaceEventDbRow,
	partitionBlockRange: string,
): BnsNamespaceEventParquetRow {
	const blockTime = blockTimeToIso(row.block_time);
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: blockTime,
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		status: row.status,
		namespace: row.namespace,
		manager: row.manager,
		manager_frozen: row.manager_frozen,
		manager_transfers_disabled: row.manager_transfers_disabled,
		price_function: row.price_function,
		price_frozen: row.price_frozen,
		lifetime: nullableInt(row.lifetime),
		revealed_at: nullableInt(row.revealed_at),
		launched_at: nullableInt(row.launched_at),
		partition_block_range: partitionBlockRange,
	};
}
