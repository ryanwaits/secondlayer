import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsBulkBlockRange } from "../../../streams-bulk/range.ts";
import { blockTimeToIso, nullableInt } from "../../_shared/row.ts";

export type BnsNameEventParquetRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: string;
	namespace: string;
	name: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	registered_at: number | null;
	imported_at: number | null;
	renewal_height: number | null;
	stx_burn: string | null;
	preordered_by: string | null;
	hashed_salted_fqn_preorder: string | null;
	partition_block_range: string;
};

type BnsNameEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string;
	tx_id: string;
	tx_index: string | number;
	event_index: string | number;
	topic: string;
	namespace: string;
	name: string;
	fqn: string;
	owner: string | null;
	bns_id: string;
	registered_at: string | number | null;
	imported_at: string | number | null;
	renewal_height: string | number | null;
	stx_burn: string | null;
	preordered_by: string | null;
	hashed_salted_fqn_preorder: string | null;
};

export async function readCanonicalBnsNameEventRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<BnsNameEventParquetRow[]> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<BnsNameEventDbRow>`
		SELECT
			cursor,
			block_height,
			block_time,
			tx_id,
			tx_index,
			event_index,
			topic,
			namespace,
			name,
			fqn,
			owner,
			bns_id,
			registered_at,
			imported_at,
			renewal_height,
			stx_burn,
			preordered_by,
			hashed_salted_fqn_preorder
		FROM bns_name_events
		WHERE canonical = true
			AND block_height >= ${params.range.fromBlock}
			AND block_height <= ${params.range.toBlock}
		ORDER BY block_height ASC, tx_index ASC, event_index ASC
	`.execute(db);
	return rows.map((row) => normalize(row, params.partitionBlockRange));
}

function normalize(
	row: BnsNameEventDbRow,
	partitionBlockRange: string,
): BnsNameEventParquetRow {
	const blockTime = blockTimeToIso(row.block_time);
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: blockTime,
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		event_index: Number(row.event_index),
		topic: row.topic,
		namespace: row.namespace,
		name: row.name,
		fqn: row.fqn,
		owner: row.owner,
		bns_id: row.bns_id,
		registered_at: nullableInt(row.registered_at),
		imported_at: nullableInt(row.imported_at),
		renewal_height: nullableInt(row.renewal_height),
		stx_burn: row.stx_burn,
		preordered_by: row.preordered_by,
		hashed_salted_fqn_preorder: row.hashed_salted_fqn_preorder,
		partition_block_range: partitionBlockRange,
	};
}
