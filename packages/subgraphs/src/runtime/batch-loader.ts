import type {
	Block,
	Database,
	Event,
	Transaction,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export interface BlockData {
	block: Block;
	txs: Transaction[];
	events: Event[];
}

/**
 * Load a range of blocks with their transactions and events in 3 parallel queries.
 * Returns a Map keyed by block height. Non-canonical blocks are excluded.
 */
export async function loadBlockRange(
	db: Kysely<Database>,
	fromHeight: number,
	toHeight: number,
): Promise<Map<number, BlockData>> {
	const [blocks, txs, events] = await Promise.all([
		db
			.selectFrom("blocks")
			.selectAll()
			.where("height", ">=", fromHeight)
			.where("height", "<=", toHeight)
			.where("canonical", "=", true)
			.execute(),
		db
			.selectFrom("transactions")
			.selectAll()
			.where("block_height", ">=", fromHeight)
			.where("block_height", "<=", toHeight)
			.execute(),
		db
			.selectFrom("events")
			.selectAll()
			.where("block_height", ">=", fromHeight)
			.where("block_height", "<=", toHeight)
			.execute(),
	]);

	// Index by block height (coerce to number — bigint columns may return as string or number)
	const txsByHeight = new Map<number, Transaction[]>();
	for (const tx of txs) {
		const h = Number(tx.block_height);
		const list = txsByHeight.get(h) ?? [];
		list.push(tx);
		txsByHeight.set(h, list);
	}

	const eventsByHeight = new Map<number, Event[]>();
	for (const evt of events) {
		const h = Number(evt.block_height);
		const list = eventsByHeight.get(h) ?? [];
		list.push(evt);
		eventsByHeight.set(h, list);
	}

	const result = new Map<number, BlockData>();
	for (const block of blocks) {
		const h = Number(block.height);
		result.set(h, {
			block,
			txs: txsByHeight.get(h) ?? [],
			events: eventsByHeight.get(h) ?? [],
		});
	}

	return result;
}

/**
 * Compute average events per block from a loaded batch.
 * Used for adaptive batch sizing.
 */
export function avgEventsPerBlock(batch: Map<number, BlockData>): number {
	if (batch.size === 0) return 0;
	let totalEvents = 0;
	for (const data of batch.values()) {
		totalEvents += data.events.length;
	}
	return totalEvents / batch.size;
}
