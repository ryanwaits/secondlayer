import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsBulkBlockRange } from "../../../streams-bulk/range.ts";

export type SbtcEventRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: string;
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
	partition_block_range: string;
};

type SbtcEventDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string;
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

export async function readCanonicalSbtcEventRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<SbtcEventRow[]> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<SbtcEventDbRow>`
		SELECT
			cursor,
			block_height,
			block_time,
			tx_id,
			tx_index,
			event_index,
			topic,
			request_id,
			amount,
			sender,
			recipient_btc_version,
			recipient_btc_hashbytes,
			bitcoin_txid,
			output_index,
			sweep_txid,
			burn_hash,
			burn_height,
			signer_bitmap,
			max_fee,
			fee,
			block_height_at_request,
			governance_contract_type,
			governance_new_contract,
			signer_aggregate_pubkey,
			signer_threshold,
			signer_address,
			signer_keys_count
		FROM sbtc_events
		WHERE canonical = true
			AND block_height >= ${params.range.fromBlock}
			AND block_height <= ${params.range.toBlock}
		ORDER BY block_height ASC, tx_index ASC, event_index ASC
	`.execute(db);

	return rows.map((row) => normalizeRow(row, params.partitionBlockRange));
}

function nullableInt(value: string | number | null): number | null {
	return value === null || value === undefined ? null : Number(value);
}

function normalizeRow(
	row: SbtcEventDbRow,
	partitionBlockRange: string,
): SbtcEventRow {
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
		topic: row.topic,
		request_id: nullableInt(row.request_id),
		amount: row.amount,
		sender: row.sender,
		recipient_btc_version: nullableInt(row.recipient_btc_version),
		recipient_btc_hashbytes: row.recipient_btc_hashbytes,
		bitcoin_txid: row.bitcoin_txid,
		output_index: nullableInt(row.output_index),
		sweep_txid: row.sweep_txid,
		burn_hash: row.burn_hash,
		burn_height: nullableInt(row.burn_height),
		signer_bitmap: row.signer_bitmap,
		max_fee: row.max_fee,
		fee: row.fee,
		block_height_at_request: nullableInt(row.block_height_at_request),
		governance_contract_type: nullableInt(row.governance_contract_type),
		governance_new_contract: row.governance_new_contract,
		signer_aggregate_pubkey: row.signer_aggregate_pubkey,
		signer_threshold: nullableInt(row.signer_threshold),
		signer_address: row.signer_address,
		signer_keys_count: nullableInt(row.signer_keys_count),
		partition_block_range: partitionBlockRange,
	};
}
