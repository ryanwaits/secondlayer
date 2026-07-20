import { getSourceDb, jsonb } from "@secondlayer/shared/db";
import type { Pox5EventTopic } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { writeDecoderCheckpoint } from "./storage.ts";

export const POX5_DECODER_NAME = "decode.pox5.v1";

export type Pox5EventRow = {
	cursor: string;
	block_height: number;
	block_time: Date;
	tx_id: string;
	tx_index: number;
	event_index: number;
	topic: Pox5EventTopic;
	staker: string | null;
	signer: string | null;
	signer_manager: string | null;
	bond_index: number | null;
	amount_ustx: string | null;
	amount_sats: string | null;
	reward_cycle: number | null;
	first_reward_cycle: number | null;
	unlock_cycle: number | null;
	unlock_burn_height: number | null;
	is_l1_lock: boolean | null;
	signer_key: string | null;
	data: unknown;
	source_cursor: string;
};

function db(client?: Kysely<Database>): Kysely<Database> {
	return client ?? getSourceDb();
}

export async function writePox5Events(
	rows: Pox5EventRow[],
	opts?: { db?: Kysely<Database> },
): Promise<void> {
	if (rows.length === 0) return;
	await db(opts?.db)
		.insertInto("pox5_events")
		.values(rows.map((row) => ({ ...row, data: jsonb(row.data) })))
		.onConflict((oc) =>
			oc.column("cursor").doUpdateSet((eb) => ({
				block_height: eb.ref("excluded.block_height"),
				block_time: eb.ref("excluded.block_time"),
				tx_id: eb.ref("excluded.tx_id"),
				tx_index: eb.ref("excluded.tx_index"),
				event_index: eb.ref("excluded.event_index"),
				topic: eb.ref("excluded.topic"),
				staker: eb.ref("excluded.staker"),
				signer: eb.ref("excluded.signer"),
				signer_manager: eb.ref("excluded.signer_manager"),
				bond_index: eb.ref("excluded.bond_index"),
				amount_ustx: eb.ref("excluded.amount_ustx"),
				amount_sats: eb.ref("excluded.amount_sats"),
				reward_cycle: eb.ref("excluded.reward_cycle"),
				first_reward_cycle: eb.ref("excluded.first_reward_cycle"),
				unlock_cycle: eb.ref("excluded.unlock_cycle"),
				unlock_burn_height: eb.ref("excluded.unlock_burn_height"),
				is_l1_lock: eb.ref("excluded.is_l1_lock"),
				signer_key: eb.ref("excluded.signer_key"),
				data: eb.ref("excluded.data"),
				canonical: true,
				source_cursor: eb.ref("excluded.source_cursor"),
			})),
		)
		.execute();
}

/**
 * Reconcile pox5_events on reorg. Mirrors `handleSbtcReorg` (sbtc-storage.ts):
 * hard-DELETE at/above the fork, NOT a canonical=false flag. `cursor` is the
 * streams event cursor — a dense per-block ordinal — so a post-reorg re-decode
 * lands on SHIFTED cursors and would insert alongside the old-fork rows; only
 * a delete clears them. Rewinds the decoder checkpoint to the last source
 * event before the fork so the new fork re-derives from a clean slate.
 */
export async function handlePox5Reorg(
	blockHeight: number,
	opts?: { db?: Kysely<Database> },
): Promise<{ deleted: number; checkpoint: string | null }> {
	const client = db(opts?.db);

	const result = await client
		.deleteFrom("pox5_events")
		.where("block_height", ">=", blockHeight)
		.executeTakeFirst();

	const checkpoint =
		(
			await client
				.selectFrom("pox5_events")
				.select("source_cursor")
				.where("block_height", "<", blockHeight)
				.orderBy("block_height", "desc")
				.orderBy("event_index", "desc")
				.limit(1)
				.executeTakeFirst()
		)?.source_cursor ?? null;
	await writeDecoderCheckpoint({
		cursor: checkpoint,
		db: opts?.db,
		decoderName: POX5_DECODER_NAME,
	});

	return {
		deleted: Number(result.numDeletedRows ?? 0),
		checkpoint,
	};
}
