import type { Kysely } from "kysely";
import type { Database, Block, Transaction, Event } from "@secondlayer/shared/db";

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
    db.selectFrom("blocks")
      .selectAll()
      .where("height", ">=", fromHeight)
      .where("height", "<=", toHeight)
      .where("canonical", "=", true)
      .execute(),
    db.selectFrom("transactions")
      .selectAll()
      .where("block_height", ">=", fromHeight)
      .where("block_height", "<=", toHeight)
      .execute(),
    db.selectFrom("events")
      .selectAll()
      .where("block_height", ">=", fromHeight)
      .where("block_height", "<=", toHeight)
      .execute(),
  ]);

  // Index by block height
  const txsByHeight = new Map<number, Transaction[]>();
  for (const tx of txs) {
    const list = txsByHeight.get(tx.block_height) ?? [];
    list.push(tx);
    txsByHeight.set(tx.block_height, list);
  }

  const eventsByHeight = new Map<number, Event[]>();
  for (const evt of events) {
    const list = eventsByHeight.get(evt.block_height) ?? [];
    list.push(evt);
    eventsByHeight.set(evt.block_height, list);
  }

  const result = new Map<number, BlockData>();
  for (const block of blocks) {
    result.set(block.height, {
      block,
      txs: txsByHeight.get(block.height) ?? [],
      events: eventsByHeight.get(block.height) ?? [],
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
