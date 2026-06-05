import { getSourceDb } from "@secondlayer/shared/db";
import type { Pox4FunctionName } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export const POX4_DECODER_NAME = "l2.pox4.v1";

export type Pox4CallRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	burn_block_height: number;
	tx_id: string;
	tx_index: number;
	function_name: Pox4FunctionName;
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
	source_cursor: string;
};

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getSourceDb();
}

export async function writePox4Calls(
	rows: Pox4CallRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("pox4_calls")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				burn_block_height: eb.ref("excluded.burn_block_height"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				function_name: eb.ref("excluded.function_name"),
				caller: eb.ref("excluded.caller"),
				stacker: eb.ref("excluded.stacker"),
				delegate_to: eb.ref("excluded.delegate_to"),
				amount_ustx: eb.ref("excluded.amount_ustx"),
				lock_period: eb.ref("excluded.lock_period"),
				pox_addr_version: eb.ref("excluded.pox_addr_version"),
				pox_addr_hashbytes: eb.ref("excluded.pox_addr_hashbytes"),
				pox_addr_btc: eb.ref("excluded.pox_addr_btc"),
				start_cycle: eb.ref("excluded.start_cycle"),
				end_cycle: eb.ref("excluded.end_cycle"),
				signer_key: eb.ref("excluded.signer_key"),
				signer_signature: eb.ref("excluded.signer_signature"),
				auth_id: eb.ref("excluded.auth_id"),
				max_amount: eb.ref("excluded.max_amount"),
				reward_cycle: eb.ref("excluded.reward_cycle"),
				aggregated_amount_ustx: eb.ref("excluded.aggregated_amount_ustx"),
				aggregated_signer_index: eb.ref("excluded.aggregated_signer_index"),
				auth_period: eb.ref("excluded.auth_period"),
				auth_topic: eb.ref("excluded.auth_topic"),
				auth_allowed: eb.ref("excluded.auth_allowed"),
				result_ok: eb.ref("excluded.result_ok"),
				result_raw: eb.ref("excluded.result_raw"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

/**
 * Mark pox4_calls rows non-canonical when a reorg invalidates a height range.
 * Returns checkpoint = max canonical cursor < blockHeight, used to roll the
 * decoder back so it re-decodes any tx that landed in the new canonical
 * fork.
 */
export async function handlePox4Reorg(
	blockHeight: number,
	opts?: { db?: Kysely<Database> },
): Promise<{ markedNonCanonical: number; checkpoint: string | null }> {
	const client = db(opts?.db);

	const result = await client
		.updateTable("pox4_calls")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const checkpointRow = await client
		.selectFrom("pox4_calls")
		.select("source_cursor")
		.where("block_height", "<", blockHeight)
		.where("canonical", "=", true)
		.orderBy("block_height", "desc")
		.orderBy("tx_index", "desc")
		.limit(1)
		.executeTakeFirst();

	return {
		markedNonCanonical: Number(result.numUpdatedRows ?? 0),
		checkpoint: checkpointRow?.source_cursor ?? null,
	};
}
