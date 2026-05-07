import { getTargetDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { SbtcEventTopic, SbtcTokenEventType } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export const SBTC_DECODER_NAME = "l2.sbtc.v1";

export type SbtcEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: SbtcEventTopic;
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
	source_cursor: string;
};

export type SbtcTokenEventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: SbtcTokenEventType;
	sender: string | null;
	recipient: string | null;
	amount: string;
	memo: string | null;
	source_cursor: string;
};

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getTargetDb();
}

export async function writeSbtcEvents(
	rows: SbtcEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("sbtc_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				topic: eb.ref("excluded.topic"),
				request_id: eb.ref("excluded.request_id"),
				amount: eb.ref("excluded.amount"),
				sender: eb.ref("excluded.sender"),
				recipient_btc_version: eb.ref("excluded.recipient_btc_version"),
				recipient_btc_hashbytes: eb.ref("excluded.recipient_btc_hashbytes"),
				bitcoin_txid: eb.ref("excluded.bitcoin_txid"),
				output_index: eb.ref("excluded.output_index"),
				sweep_txid: eb.ref("excluded.sweep_txid"),
				burn_hash: eb.ref("excluded.burn_hash"),
				burn_height: eb.ref("excluded.burn_height"),
				signer_bitmap: eb.ref("excluded.signer_bitmap"),
				max_fee: eb.ref("excluded.max_fee"),
				fee: eb.ref("excluded.fee"),
				block_height_at_request: eb.ref("excluded.block_height_at_request"),
				governance_contract_type: eb.ref("excluded.governance_contract_type"),
				governance_new_contract: eb.ref("excluded.governance_new_contract"),
				signer_aggregate_pubkey: eb.ref("excluded.signer_aggregate_pubkey"),
				signer_threshold: eb.ref("excluded.signer_threshold"),
				signer_address: eb.ref("excluded.signer_address"),
				signer_keys_count: eb.ref("excluded.signer_keys_count"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

export async function writeSbtcTokenEvents(
	rows: SbtcTokenEventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("sbtc_token_events")
		.values(rows)
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				event_type: eb.ref("excluded.event_type"),
				sender: eb.ref("excluded.sender"),
				recipient: eb.ref("excluded.recipient"),
				amount: eb.ref("excluded.amount"),
				memo: eb.ref("excluded.memo"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

/**
 * Mark sBTC rows non-canonical when a reorg invalidates a height range.
 * Mirrors `handleDecodedEventsReorg` in storage.ts but scoped to the two
 * sBTC tables.
 */
export async function handleSbtcReorg(
	blockHeight: number,
	opts?: { db?: Kysely<Database> },
): Promise<{ markedNonCanonical: number; checkpoint: string | null }> {
	const client = db(opts?.db);

	const eventsResult = await client
		.updateTable("sbtc_events")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const tokenResult = await client
		.updateTable("sbtc_token_events")
		.set({ canonical: false })
		.where("block_height", ">=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();

	const checkpointRow = await client
		.selectFrom("sbtc_events")
		.select("source_cursor")
		.where("block_height", "<", blockHeight)
		.where("canonical", "=", true)
		.orderBy("block_height", "desc")
		.orderBy("event_index", "desc")
		.limit(1)
		.executeTakeFirst();

	return {
		markedNonCanonical:
			Number(eventsResult.numUpdatedRows ?? 0) +
			Number(tokenResult.numUpdatedRows ?? 0),
		checkpoint: checkpointRow?.source_cursor ?? null,
	};
}
