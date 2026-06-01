import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import type { StreamsBulkBlockRange } from "../../../streams-bulk/range.ts";

export type Pox4CallParquetRow = {
	cursor: string;
	block_height: number;
	block_time: string;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	function_name: string;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: number | null;
	pox_addr_version: number | null;
	pox_addr_hashbytes: string | null;
	pox_addr_btc: string | null;
	start_cycle: number | null;
	end_cycle: number | null;
	signer_key: string | null;
	signer_signature: string | null;
	auth_id: string | null;
	max_amount: string | null;
	reward_cycle: number | null;
	aggregated_amount_ustx: string | null;
	aggregated_signer_index: number | null;
	auth_period: number | null;
	auth_topic: string | null;
	auth_allowed: boolean | null;
	result_ok: boolean;
	result_raw: string;
	partition_block_range: string;
};

type Pox4CallDbRow = {
	cursor: string;
	block_height: string | number;
	block_time: Date | string;
	burn_block_height: string | number;
	tx_id: string;
	tx_index: string | number;
	function_name: string;
	caller: string;
	stacker: string | null;
	delegate_to: string | null;
	amount_ustx: string | null;
	lock_period: string | number | null;
	pox_addr_version: string | number | null;
	pox_addr_hashbytes: string | null;
	pox_addr_btc: string | null;
	start_cycle: string | number | null;
	end_cycle: string | number | null;
	signer_key: string | null;
	signer_signature: string | null;
	auth_id: string | null;
	max_amount: string | null;
	reward_cycle: string | number | null;
	aggregated_amount_ustx: string | null;
	aggregated_signer_index: string | number | null;
	auth_period: string | number | null;
	auth_topic: string | null;
	auth_allowed: boolean | null;
	result_ok: boolean;
	result_raw: string;
};

export async function readCanonicalPox4CallRows(params: {
	range: StreamsBulkBlockRange;
	partitionBlockRange: string;
	db?: Kysely<Database>;
}): Promise<Pox4CallParquetRow[]> {
	const db = params.db ?? getSourceDb();
	const { rows } = await sql<Pox4CallDbRow>`
		SELECT
			cursor,
			block_height,
			block_time,
			burn_block_height,
			tx_id,
			tx_index,
			function_name,
			caller,
			stacker,
			delegate_to,
			amount_ustx,
			lock_period,
			pox_addr_version,
			pox_addr_hashbytes,
			pox_addr_btc,
			start_cycle,
			end_cycle,
			signer_key,
			signer_signature,
			auth_id,
			max_amount,
			reward_cycle,
			aggregated_amount_ustx,
			aggregated_signer_index,
			auth_period,
			auth_topic,
			auth_allowed,
			result_ok,
			result_raw
		FROM pox4_calls
		WHERE canonical = true
			AND block_height >= ${params.range.fromBlock}
			AND block_height <= ${params.range.toBlock}
		ORDER BY block_height ASC, tx_index ASC
	`.execute(db);

	return rows.map((row) => normalize(row, params.partitionBlockRange));
}

function nullableInt(value: string | number | null): number | null {
	return value === null || value === undefined ? null : Number(value);
}

function normalize(
	row: Pox4CallDbRow,
	partitionBlockRange: string,
): Pox4CallParquetRow {
	const blockTime =
		row.block_time instanceof Date
			? row.block_time.toISOString()
			: new Date(row.block_time).toISOString();
	return {
		cursor: row.cursor,
		block_height: Number(row.block_height),
		block_time: blockTime,
		burn_block_height: Number(row.burn_block_height),
		tx_id: row.tx_id,
		tx_index: Number(row.tx_index),
		function_name: row.function_name,
		caller: row.caller,
		stacker: row.stacker,
		delegate_to: row.delegate_to,
		amount_ustx: row.amount_ustx,
		lock_period: nullableInt(row.lock_period),
		pox_addr_version: nullableInt(row.pox_addr_version),
		pox_addr_hashbytes: row.pox_addr_hashbytes,
		pox_addr_btc: row.pox_addr_btc,
		start_cycle: nullableInt(row.start_cycle),
		end_cycle: nullableInt(row.end_cycle),
		signer_key: row.signer_key,
		signer_signature: row.signer_signature,
		auth_id: row.auth_id,
		max_amount: row.max_amount,
		reward_cycle: nullableInt(row.reward_cycle),
		aggregated_amount_ustx: row.aggregated_amount_ustx,
		aggregated_signer_index: nullableInt(row.aggregated_signer_index),
		auth_period: nullableInt(row.auth_period),
		auth_topic: row.auth_topic,
		auth_allowed: row.auth_allowed,
		result_ok: row.result_ok,
		result_raw: row.result_raw,
		partition_block_range: partitionBlockRange,
	};
}
