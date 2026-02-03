import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared/db";
import type { NewBlockPayload } from "../src/types/node-events.ts";

const INDEXER_URL = process.env.INDEXER_URL || "http://localhost:3700";
const HAS_DB = !!process.env.DATABASE_URL;
const HAS_INDEXER = !!process.env.INDEXER_URL;
const FIXTURE_PATH = new URL("../../../fixtures/mainnet-block-142800.json", import.meta.url).pathname;
const HAS_FIXTURE = await Bun.file(FIXTURE_PATH).exists();
const CAN_RUN = HAS_DB && HAS_FIXTURE && HAS_INDEXER;

// Load fixture lazily — only if we can actually run
let fixture: NewBlockPayload;
if (CAN_RUN) {
  fixture = await Bun.file(FIXTURE_PATH).json();
}

describe.skipIf(!CAN_RUN)("Indexer Integration Test", () => {
  beforeAll(async () => {
    // Ensure database is clean
    const db = getDb();
    await db.deleteFrom("events").execute();
    await db.deleteFrom("transactions").execute();
    await db.deleteFrom("blocks").execute();
    await db.deleteFrom("index_progress").execute();
  });

  test("POST /health returns 200", async () => {
    const response = await fetch(`${INDEXER_URL}/health`);
    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("ok");
  });

  test("POST /new_block stores block in database", async () => {
    const response = await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fixture),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { status: string; block_height: number };
    expect(data.status).toBe("ok");
    expect(data.block_height).toBe(142800);

    // Verify block was stored
    const db = getDb();
    const block = await db
      .selectFrom("blocks")
      .selectAll()
      .where("height", "=", 142800)
      .executeTakeFirst();

    expect(block).toBeDefined();
    expect(block!.hash).toBe(fixture.block_hash);
    expect(block!.canonical).toBe(true);
  });

  test("POST /new_block stores transactions", async () => {
    const db = getDb();
    const txs = await db
      .selectFrom("transactions")
      .selectAll()
      .where("block_height", "=", 142800)
      .execute();

    expect(txs.length).toBe(2);
    expect(txs[0]?.type).toBe("token_transfer");
    expect(txs[1]?.type).toBe("contract_call");
    expect(txs[1]?.contract_id).toBe("SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.test-contract");
    expect(txs[1]?.function_name).toBe("transfer");
  });

  test("POST /new_block stores events", async () => {
    const db = getDb();
    const evts = await db
      .selectFrom("events")
      .selectAll()
      .where("block_height", "=", 142800)
      .execute();

    expect(evts.length).toBe(2);
    expect(evts[0]?.type).toBe("stx_transfer_event");
    expect(evts[1]?.type).toBe("ft_transfer_event");
  });

  test("POST /new_block updates index_progress", async () => {
    const db = getDb();
    const progress = await db
      .selectFrom("index_progress")
      .selectAll()
      .executeTakeFirst();

    expect(progress).toBeDefined();
    expect(progress!.last_indexed_block).toBe(142800);
    expect(progress!.highest_seen_block).toBe(142800);
  });

  test("duplicate POST is idempotent", async () => {
    const response = await fetch(`${INDEXER_URL}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fixture),
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as { message: string };
    expect(data.message).toBe("duplicate");

    // Verify still only 1 block
    const db = getDb();
    const { rows } = await sql<{ count: number }>`SELECT count(*) as count FROM blocks WHERE height = 142800`.execute(db);
    expect(Number(rows[0]!.count)).toBe(1);
  });

  afterAll(async () => {
    // Cleanup
    const db = getDb();
    await db.deleteFrom("events").execute();
    await db.deleteFrom("transactions").execute();
    await db.deleteFrom("blocks").execute();
    await db.deleteFrom("index_progress").execute();
  });
});
