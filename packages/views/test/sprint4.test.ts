import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { sql } from "kysely";
import { registerView, getView, deleteView } from "@secondlayer/shared/db/queries/views";
import { deploySchema } from "../src/schema/deployer.ts";
import { handleViewReorg } from "../src/runtime/reorg.ts";
import type { ViewDefinition, ViewSchema } from "../src/types.ts";

const SKIP = !process.env.DATABASE_URL;

const VIEW_NAME = "sprint4-test";
const PG_SCHEMA = "view_sprint4_test";

const baseDef: ViewDefinition = {
  name: VIEW_NAME,
  version: "1.0.0",
  sources: [{ contract: "SP123::test" }],
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal" },
        amount: { type: "uint" },
      },
    },
  },
  handlers: { "*": async () => {} },
};

async function cleanup() {
  const db = getDb();
  const client = getRawClient();
  await client.unsafe(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`);
  await db.deleteFrom("views").execute();
}

// ── Deploy with forceReindex ────────────────────────────────────────────

describe.skipIf(SKIP)("Deploy with breaking changes", () => {
  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(cleanup);

  test("deploy creates new view", async () => {
    const db = getDb();
    const result = await deploySchema(db, baseDef, "/tmp/handler.ts");
    expect(result.action).toBe("created");
    expect(result.viewId).toBeDefined();

    const view = await getView(db, VIEW_NAME);
    expect(view).not.toBeNull();
    expect(view!.status).toBe("active");
  });

  test("deploy unchanged returns unchanged", async () => {
    const db = getDb();
    await deploySchema(db, baseDef, "/tmp/handler.ts");
    const result = await deploySchema(db, baseDef, "/tmp/handler.ts");
    expect(result.action).toBe("unchanged");
  });

  test("deploy with breaking change throws without --reindex", async () => {
    const db = getDb();
    await deploySchema(db, baseDef, "/tmp/handler.ts");

    // Remove a column = breaking change
    const breakingDef: ViewDefinition = {
      ...baseDef,
      version: "2.0.0",
      schema: {
        transfers: {
          columns: {
            sender: { type: "principal" },
            // amount removed
          },
        },
      },
    };

    expect(deploySchema(db, breakingDef, "/tmp/handler.ts")).rejects.toThrow(
      "Breaking schema change detected",
    );
  });

  test("deploy with breaking change + forceReindex succeeds", async () => {
    const db = getDb();
    await deploySchema(db, baseDef, "/tmp/handler.ts");

    // Insert a row into the table to verify it gets dropped
    const client = getRawClient();
    await client.unsafe(
      `INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES (1, 'tx1', 'SP_A', 100)`,
    );
    const before = await client.unsafe(`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`);
    expect(parseInt(String(before[0]?.count), 10)).toBe(1);

    // Deploy with breaking change + forceReindex
    const breakingDef: ViewDefinition = {
      ...baseDef,
      version: "2.0.0",
      schema: {
        transfers: {
          columns: {
            sender: { type: "principal" },
            // amount removed
          },
        },
      },
    };

    const result = await deploySchema(db, breakingDef, "/tmp/handler.ts", {
      forceReindex: true,
    });
    expect(result.action).toBe("reindexed");

    // Table should be recreated (empty)
    const after = await client.unsafe(`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`);
    expect(parseInt(String(after[0]?.count), 10)).toBe(0);

    // Verify new schema only has "sender" column (no "amount")
    const cols = await client.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${PG_SCHEMA}' AND table_name = 'transfers'
       ORDER BY ordinal_position`,
    );
    const colNames = cols.map((r: any) => r.column_name);
    expect(colNames).toContain("sender");
    expect(colNames).not.toContain("amount");
    expect(colNames).toContain("_id");
    expect(colNames).toContain("_block_height");
  });

  test("deploy with additive change succeeds without forceReindex", async () => {
    const db = getDb();
    await deploySchema(db, baseDef, "/tmp/handler.ts");

    const additiveDef: ViewDefinition = {
      ...baseDef,
      version: "1.1.0",
      schema: {
        transfers: {
          columns: {
            sender: { type: "principal" },
            amount: { type: "uint" },
            memo: { type: "text", nullable: true },
          },
        },
      },
    };

    const result = await deploySchema(db, additiveDef, "/tmp/handler.ts");
    expect(result.action).toBe("updated");

    // Verify new column exists
    const client = getRawClient();
    const cols = await client.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = '${PG_SCHEMA}' AND table_name = 'transfers'`,
    );
    const colNames = cols.map((r: any) => r.column_name);
    expect(colNames).toContain("memo");
  });
});

// ── Reorg propagation ───────────────────────────────────────────────────

describe.skipIf(SKIP)("Reorg propagation to views", () => {
  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(cleanup);

  test("handleViewReorg deletes rows at reorged block height", async () => {
    const db = getDb();
    const client = getRawClient();

    // Deploy view and insert data at different block heights
    await deploySchema(db, baseDef, "/tmp/handler.ts");

    await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
        (100, 'tx1', 'SP_A', 1000),
        (100, 'tx2', 'SP_B', 2000),
        (101, 'tx3', 'SP_C', 3000),
        (102, 'tx4', 'SP_D', 4000)
    `);

    const beforeCount = await client.unsafe(`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`);
    expect(parseInt(String(beforeCount[0]?.count), 10)).toBe(4);

    // Simulate reorg at block 100
    const mockLoadDef = async (_path: string) => baseDef;
    await handleViewReorg(100, mockLoadDef);

    // Rows at block 100 should be deleted
    const afterCount = await client.unsafe(`SELECT COUNT(*) as count FROM ${PG_SCHEMA}.transfers`);
    expect(parseInt(String(afterCount[0]?.count), 10)).toBe(2);

    // Verify remaining rows are at heights 101 and 102
    const remaining = await client.unsafe(
      `SELECT DISTINCT "_block_height" FROM ${PG_SCHEMA}.transfers ORDER BY "_block_height"`,
    );
    expect(remaining.map((r: any) => Number(r._block_height))).toEqual([101, 102]);
  });

  test("handleViewReorg skips views without schema definition", async () => {
    const db = getDb();

    // Register a view with no schema in definition
    await registerView(db, {
      name: VIEW_NAME,
      version: "1.0.0",
      definition: { name: VIEW_NAME, sources: [{ contract: "SP::c" }] },
      schemaHash: "abc",
      handlerPath: "/tmp/handler.ts",
    });

    // Should not throw
    const mockLoadDef = async (_path: string) => baseDef;
    await handleViewReorg(100, mockLoadDef);
  });

  test("handleViewReorg only affects specified block height", async () => {
    const db = getDb();
    const client = getRawClient();

    await deploySchema(db, baseDef, "/tmp/handler.ts");

    await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.transfers ("_block_height", "_tx_id", "sender", "amount") VALUES
        (200, 'tx1', 'SP_A', 1000),
        (201, 'tx2', 'SP_B', 2000),
        (202, 'tx3', 'SP_C', 3000)
    `);

    const mockLoadDef = async (_path: string) => baseDef;
    await handleViewReorg(201, mockLoadDef);

    // Only block 201 should be removed
    const rows = await client.unsafe(
      `SELECT "_block_height" FROM ${PG_SCHEMA}.transfers ORDER BY "_block_height"`,
    );
    expect(rows.map((r: any) => Number(r._block_height))).toEqual([200, 202]);
  });
});
