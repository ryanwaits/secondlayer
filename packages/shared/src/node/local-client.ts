/**
 * Local replay client — reconstructs NewBlockPayload from our own Postgres.
 *
 * Used for re-orgs, reprocessing, and self-serve replay after genesis sync.
 * Eliminates need for self-hosted Hiro API for blocks already in our DB.
 */

import type { Kysely } from "kysely";
import type { Database } from "../db/types.ts";
import {
	VM_STORED_TO_NODE_TYPE,
	type VmEventType,
	type VmNodeEventType,
} from "../event-types.ts";

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
	/** Node-shaped opt-in traces. Omitted when the height has none. */
	vm_events?: ReplayVmEventPayload[];
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

/** Node-shaped `/new_block.vm_events[]` row. Body lives under the node type
 *  key so `parseVmEvent` can re-ingest it on fork restoration. */
export interface ReplayVmEventPayload {
	txid: string;
	vm_event_index: number;
	committed: boolean;
	type: VmNodeEventType;
	[key: string]: unknown;
}

/** Rebuild node-shaped vm traces from stored rows. Original `vm_event_index`
 *  is preserved — the second clock must not be rewritten on flip-back. */
export function reconstructVmEventsForReplay(
	rows: ReadonlyArray<{
		tx_id: string;
		vm_event_index: number | string;
		type: string;
		data: unknown;
	}>,
): ReplayVmEventPayload[] {
	const out: ReplayVmEventPayload[] = [];
	for (const row of rows) {
		const nodeType =
			row.type in VM_STORED_TO_NODE_TYPE
				? VM_STORED_TO_NODE_TYPE[row.type as VmEventType]
				: undefined;
		if (!nodeType) continue;
		out.push({
			txid: row.tx_id,
			vm_event_index: Number(row.vm_event_index),
			committed: true,
			type: nodeType,
			[nodeType]: row.data,
		});
	}
	return out;
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

		const vmRows = await db
			.selectFrom("vm_events")
			.select(["tx_id", "vm_event_index", "type", "data"])
			.where("block_height", "=", height)
			.orderBy("vm_event_index", "asc")
			.execute();
		const vm_events = reconstructVmEventsForReplay(vmRows);

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
			...(vm_events.length > 0 ? { vm_events } : {}),
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
