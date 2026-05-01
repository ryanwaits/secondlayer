/**
 * Local replay client — reconstructs NewBlockPayload from our own Postgres.
 *
 * Used for re-orgs, reprocessing, and self-serve replay after genesis sync.
 * Eliminates need for self-hosted Hiro API for blocks already in our DB.
 */

import type { Kysely } from "kysely";
import type { Database } from "../db/types.ts";

/** Matches the NewBlockPayload shape expected by the indexer's /new_block endpoint */
export interface ReplayBlockPayload {
	block_hash: string;
	block_height: number;
	index_block_hash: string;
	parent_block_hash: string;
	parent_index_block_hash: string;
	burn_block_hash: string;
	burn_block_height: number;
	burn_block_timestamp: number;
	miner_txid: string;
	timestamp: number;
	transactions: ReplayTransactionPayload[];
	events: ReplayEventPayload[];
}

interface ReplayTransactionPayload {
	txid: string;
	raw_tx: string;
	status: string;
	tx_index: number;
	tx_type?: string;
	sender_address?: string;
	raw_result?: string | null;
	contract_call?: { function_args: string[] };
}

interface ReplayEventPayload {
	txid: string;
	event_index: number;
	committed: boolean;
	type: string;
	[key: string]: unknown;
}

export class LocalClient {
	/**
	 * Reconstruct a NewBlockPayload from local DB for replay.
	 * Returns null if block not found.
	 */
	async getBlockForReplay(
		db: Kysely<Database>,
		height: number,
	): Promise<ReplayBlockPayload | null> {
		const block = await db
			.selectFrom("blocks")
			.selectAll()
			.where("height", "=", height)
			.where("canonical", "=", true)
			.executeTakeFirst();

		if (!block) return null;

		const transactions = await db
			.selectFrom("transactions")
			.selectAll()
			.where("block_height", "=", height)
			.orderBy("tx_index", "asc")
			.execute();

		const events = await db
			.selectFrom("events")
			.selectAll()
			.where("block_height", "=", height)
			.orderBy("event_index", "asc")
			.execute();

		return {
			block_hash: block.hash,
			block_height: block.height,
			// Not stored in our DB — not needed by parser/deliveries
			index_block_hash: "",
			parent_block_hash: block.parent_hash,
			parent_index_block_hash: "",
			burn_block_hash: "",
			burn_block_height: block.burn_block_height,
			burn_block_timestamp: block.timestamp,
			miner_txid: "",
			timestamp: block.timestamp,
			transactions: transactions.map((tx) => {
				const entry: ReplayTransactionPayload = {
					txid: tx.tx_id,
					raw_tx: tx.raw_tx,
					status: tx.status,
					tx_index: tx.tx_index,
					tx_type: tx.type,
					sender_address: tx.sender,
					raw_result: tx.raw_result ?? null,
				};
				// Include function_args if stored (for contract_call txs)
				if (tx.function_args) {
					const args =
						typeof tx.function_args === "string"
							? JSON.parse(tx.function_args)
							: tx.function_args;
					if (Array.isArray(args)) {
						entry.contract_call = { function_args: args };
					}
				}
				return entry;
			}),
			events: events.map((evt) => {
				const data = (evt.data ?? {}) as Record<string, unknown>;
				const eventType = evt.type;

				// Reconstruct the flat event structure the indexer expects:
				// { txid, event_index, committed, type, [type_key]: data }
				const payload: ReplayEventPayload = {
					txid: evt.tx_id,
					event_index: evt.event_index,
					committed: true,
					type: eventType,
				};

				// Attach event-specific data under the correct key
				if (eventType && data) {
					payload[eventType] = data;
				}

				return payload;
			}),
		};
	}

	/** Get highest block height in local DB */
	async getChainTip(db: Kysely<Database>): Promise<number> {
		const row = await db
			.selectFrom("blocks")
			.select((eb) => eb.fn.max("height").as("max_height"))
			.where("canonical", "=", true)
			.executeTakeFirst();
		return Number(row?.max_height ?? 0);
	}

	/** Check if a specific block height exists in local DB */
	async hasBlock(db: Kysely<Database>, height: number): Promise<boolean> {
		const row = await db
			.selectFrom("blocks")
			.select("height")
			.where("height", "=", height)
			.where("canonical", "=", true)
			.executeTakeFirst();
		return !!row;
	}
}
