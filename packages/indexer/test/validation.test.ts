import { describe, test, expect, beforeAll } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared/db";

const INDEXER_URL = process.env.INDEXER_URL || "http://localhost:3700";
const HAS_DB = !!process.env.DATABASE_URL;

// These tests require a running indexer + database
let CAN_RUN = HAS_DB;
if (HAS_DB) {
  try {
    const res = await fetch(`${INDEXER_URL}/health`);
    CAN_RUN = res.ok;
  } catch {
    CAN_RUN = false;
  }
}

function makeBlockPayload(height: number, hash: string, parentHash: string) {
  return {
    block_height: height,
    block_hash: hash,
    parent_block_hash: parentHash,
    burn_block_height: height,
    burn_block_hash: `0xburn${height}`,
    burn_block_time: Math.floor(Date.now() / 1000),
    index_block_hash: `0xindex${height}`,
    parent_index_block_hash: `0xindex${height - 1}`,
    miner_txid: "0x0000",
    transactions: [],
    events: [],
  };
}

describe.skipIf(!CAN_RUN)("Indexer Validation (Sprint 2)", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.deleteFrom("events").execute();
    await db.deleteFrom("transactions").execute();
    await db.deleteFrom("blocks").execute();
    await db.deleteFrom("index_progress").execute();
  });

  test("health endpoint includes out-of-order counter", async () => {
    const res = await fetch(`${INDEXER_URL}/health`);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty("blocksReceivedOutOfOrder");
    expect(typeof data.blocksReceivedOutOfOrder).toBe("number");
  });

  test("blocks index normally with parent hash match", async () => {
    // Insert block 1 (no parent check for height 1)
    const res1 = await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBlockPayload(1, "0xblock1", "0xgenesis")),
    });
    expect(res1.status).toBe(200);

    // Insert block 2 with correct parent hash
    const res2 = await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBlockPayload(2, "0xblock2", "0xblock1")),
    });
    expect(res2.status).toBe(200);

    // Both should be stored
    const db = getDb();
    const stored = await db.selectFrom("blocks").selectAll().where("canonical", "=", true).execute();
    expect(stored.length).toBeGreaterThanOrEqual(2);
  });

  test("block with mismatched parent hash still indexes (warn only)", async () => {
    // Insert block 3 with wrong parent hash — should still succeed
    const res = await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBlockPayload(3, "0xblock3", "0xWRONG_PARENT")),
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const stored = await db.selectFrom("blocks").selectAll().where("height", "=", 3).execute();
    expect(stored.length).toBe(1);
  });

  test("block with missing parent still indexes (warn only)", async () => {
    // Insert block 10 — parent (block 9) doesn't exist
    const res = await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBlockPayload(10, "0xblock10", "0xblock9")),
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const stored = await db.selectFrom("blocks").selectAll().where("height", "=", 10).execute();
    expect(stored.length).toBe(1);
  });

  test("out-of-order blocks increment counter", async () => {
    // Get current counter
    const before = await fetch(`${INDEXER_URL}/health`);
    const beforeData = (await before.json()) as { blocksReceivedOutOfOrder: number };
    const countBefore = beforeData.blocksReceivedOutOfOrder;

    // Send block 8 (lower than lastSeen which should be 10)
    await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBlockPayload(8, "0xblock8", "0xblock7")),
    });

    // Send block 9
    await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeBlockPayload(9, "0xblock9", "0xblock8")),
    });

    const after = await fetch(`${INDEXER_URL}/health`);
    const afterData = (await after.json()) as { blocksReceivedOutOfOrder: number };
    expect(afterData.blocksReceivedOutOfOrder).toBe(countBefore + 2);
  });
});
