import type {
	Block,
	Database,
	Event,
	Transaction,
} from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/** A runtime event row. `clock: "vm"` marks an opt-in `vm_events` row whose
 *  `event_index` is `ordinal` — a second ordinal that never sorts or
 *  dedupes against classic `events.event_index`. */
export type RuntimeEvent = Event & { clock?: "vm" };

export interface BlockData {
	block: Block;
	txs: Transaction[];
	/** Classic `events` rows (Streams 1.0 clock). */
	events: Event[];
	/** Opt-in `vm_events` rows on their own clock. Absent/empty on `"*"`
	 *  nodes and on archives collected without `storage`/`contract_calls`. */
	vmEvents?: RuntimeEvent[];
}

/** Stable synthetic id for a vm row. Distinct from the classic `tx#index`
 *  so a print at event_index N and a map_set at ordinal N never share
 *  an identity. */
export function vmEventId(txId: string, vmEventIndex: number): string {
	return `${txId}#vm:${vmEventIndex}`;
}

/**
 * Load a range of blocks with their transactions and events in 4 parallel queries.
 * Returns a Map keyed by block height. Non-canonical blocks are excluded.
 */
export async function loadBlockRange(
	db: Kysely<Database>,
	fromHeight: number,
	toHeight: number,
): Promise<Map<number, BlockData>> {
	const [blocks, txs, events, vmRows] = await Promise.all([
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
		db
			.selectFrom("vm_events")
			.selectAll()
			.where("block_height", ">=", fromHeight)
			.where("block_height", "<=", toHeight)
			.orderBy("ordinal", "asc")
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

	const vmByHeight = new Map<number, RuntimeEvent[]>();
	for (const row of vmRows) {
		const h = Number(row.block_height);
		const list = vmByHeight.get(h) ?? [];
		list.push({
			id: vmEventId(row.tx_id, Number(row.ordinal)),
			tx_id: row.tx_id,
			block_height: h,
			event_index: Number(row.ordinal),
			type: row.type,
			data: row.data,
			created_at: row.created_at,
			clock: "vm",
		} as RuntimeEvent);
		vmByHeight.set(h, list);
	}

	const result = new Map<number, BlockData>();
	for (const block of blocks) {
		const h = Number(block.height);
		result.set(h, {
			block,
			txs: txsByHeight.get(h) ?? [],
			events: eventsByHeight.get(h) ?? [],
			vmEvents: vmByHeight.get(h) ?? [],
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
