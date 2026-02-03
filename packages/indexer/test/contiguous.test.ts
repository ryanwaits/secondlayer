import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { sql } from "@secondlayer/shared/db";
import { computeContiguousTip } from "@secondlayer/shared/db/queries/integrity";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("contiguous block tracking", () => {
  const db = HAS_DB ? getDb() : (null as any);

  beforeAll(async () => {
    await sql`DELETE FROM events`.execute(db);
    await sql`DELETE FROM transactions`.execute(db);
    await sql`DELETE FROM blocks`.execute(db);
    await sql`DELETE FROM index_progress`.execute(db);
  });

  beforeEach(async () => {
    await sql`DELETE FROM events`.execute(db);
    await sql`DELETE FROM transactions`.execute(db);
    await sql`DELETE FROM blocks`.execute(db);
    await sql`DELETE FROM index_progress`.execute(db);
  });

  async function insertBlock(height: number) {
    await db.insertInto("blocks").values({
      height,
      hash: `0x${height.toString(16).padStart(64, "0")}`,
      parent_hash: `0x${(height - 1).toString(16).padStart(64, "0")}`,
      burn_block_height: height,
      timestamp: Math.floor(Date.now() / 1000),
      canonical: true,
    }).onConflict((oc: any) => oc.column("height").doNothing()).execute();
  }

  test("sequential blocks 1,2,3 → contiguous tip = 3", async () => {
    for (const h of [1, 2, 3]) {
      await insertBlock(h);
    }
    const tip = await computeContiguousTip(db, 1);
    expect(tip).toBe(3);
  });

  test("inserting block 5 (gap) → contiguous tip from 1 = 3", async () => {
    for (const h of [1, 2, 3, 5]) {
      await insertBlock(h);
    }
    const tip = await computeContiguousTip(db, 1);
    expect(tip).toBe(3);
  });

  test("filling gap with block 4 → contiguous tip from 1 = 5", async () => {
    for (const h of [1, 2, 3, 5, 4]) {
      await insertBlock(h);
    }
    const tip = await computeContiguousTip(db, 1);
    expect(tip).toBe(5);
  });
});
