import type {
	Block,
	Database,
	Event,
	Transaction,
} from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";
import type { EventRecord, TxRecord } from "./source-matcher.ts";
import { type StateWriteRow, stateWriteEvents } from "./state-writes.ts";

/** A runtime event row. `clock: "vm"` marks an opt-in `vm_events` row whose
 *  `event_index` is `ordinal` — a second ordinal that never sorts or
 *  dedupes against classic `events.event_index`. */
export type RuntimeEvent = Event & { clock?: "vm" };

export interface BlockData {
	block: Block;
	/** The block's transactions. Under a `state_writes` feed, only the ones
	 *  its named writes hang on (see `stateWriteEvents`). */
	txs: TxRecord[];
	/** Classic `events` rows (Streams 1.0 clock). */
	events: Event[];
	/** Write events on their own clock: opt-in `vm_events` rows, or named
	 *  `state_writes` for a state subgraph. Absent/empty on `"*"` nodes and on
	 *  archives collected without `storage`/`contract_calls`. */
	vmEvents?: EventRecord[];
}

/**
 * Which node storage writes feed a state subgraph's write sources, in place
 * of `vm_events`. `contracts: null` reads every contract's writes (a source
 * with no fixed contract).
 */
export interface StateWriteFeed {
	contracts: string[] | null;
}

/** Each block's writes run through {@link stateWriteEvents} with that block's
 *  own transactions, keyed by `tx_index`. */
export function stateWriteBlocks(
	writesByHeight: ReadonlyMap<number, StateWriteRow[]>,
	txsByHeight: ReadonlyMap<number, readonly TxRecord[]>,
): Map<number, { txs: TxRecord[]; vmEvents: EventRecord[] }> {
	const out = new Map<number, { txs: TxRecord[]; vmEvents: EventRecord[] }>();
	for (const [height, writes] of writesByHeight) {
		const txByIndex = new Map<number, TxRecord>();
		for (const tx of txsByHeight.get(height) ?? []) {
			if (tx.tx_index !== undefined) txByIndex.set(tx.tx_index, tx);
		}
		out.set(height, stateWriteEvents(writes, txByIndex));
	}
	return out;
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
 * With `stateWrites`, write events come from `state_writes` instead of
 * `vm_events`.
 */
export async function loadBlockRange(
	db: Kysely<Database>,
	fromHeight: number,
	toHeight: number,
	opts: { stateWrites?: StateWriteFeed } = {},
): Promise<Map<number, BlockData>> {
	const feed = opts.stateWrites;
	const [blocks, txs, events, vmRows, writeRows] = await Promise.all([
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
		feed
			? Promise.resolve([])
			: db
					.selectFrom("vm_events")
					.selectAll()
					.where("block_height", ">=", fromHeight)
					.where("block_height", "<=", toHeight)
					.orderBy("ordinal", "asc")
					.execute(),
		feed
			? loadStateWrites(db, fromHeight, toHeight, feed)
			: Promise.resolve([]),
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

	const writesByHeight = new Map<number, StateWriteRow[]>();
	for (const row of writeRows) {
		const h = Number(row.block_height);
		const list = writesByHeight.get(h) ?? [];
		list.push({
			ordinal: Number(row.ordinal),
			tx_index: row.tx_index === null ? null : Number(row.tx_index),
			key: row.key,
			value_hex: row.value_hex,
		});
		writesByHeight.set(h, list);
	}
	const named = stateWriteBlocks(writesByHeight, txsByHeight);

	const result = new Map<number, BlockData>();
	for (const block of blocks) {
		const h = Number(block.height);
		const fed = named.get(h);
		result.set(h, {
			block,
			txs: feed ? (fed?.txs ?? []) : (txsByHeight.get(h) ?? []),
			events: eventsByHeight.get(h) ?? [],
			vmEvents: feed ? (fed?.vmEvents ?? []) : (vmByHeight.get(h) ?? []),
		});
	}

	return result;
}

/** `state_writes` over the range, scoped to the feed's contracts' keys. */
async function loadStateWrites(
	db: Kysely<Database>,
	fromHeight: number,
	toHeight: number,
	feed: StateWriteFeed,
): Promise<
	Array<{
		block_height: number;
		ordinal: number;
		tx_index: number | null;
		key: string;
		value_hex: string;
	}>
> {
	// `starts_with`, not LIKE: `_` in a contract name is a LIKE wildcard.
	const scope = feed.contracts
		? sql`AND (${sql.join(
				feed.contracts.map((c) => sql`starts_with(key, ${`vm::${c}::`})`),
				sql` OR `,
			)})`
		: sql``;
	const { rows } = await sql<{
		block_height: number;
		ordinal: number;
		tx_index: number | null;
		key: string;
		value_hex: string;
	}>`
		SELECT block_height, ordinal, tx_index, key, value_hex
		FROM state_writes
		WHERE block_height >= ${fromHeight} AND block_height <= ${toHeight} ${scope}
		ORDER BY block_height, ordinal
	`.execute(db);
	return rows;
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
