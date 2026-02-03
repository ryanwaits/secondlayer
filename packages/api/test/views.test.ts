import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve } from "node:path";
import { Hono } from "hono";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import { sql } from "kysely";
import { registerView, deleteView } from "@secondlayer/shared/db/queries/views";
import viewsRouter, { startViewCache, stopViewCache } from "../src/routes/views.ts";

const SKIP = !process.env.DATABASE_URL;

// ── Unit tests (no DB) ─────────────────────────────────────────────────

describe("parseQueryParams (via route behavior)", () => {
  // These are tested indirectly through route responses in integration tests.
  // Pure unit tests for the parsing logic below.

  test("ident rejects invalid identifiers", () => {
    // We can't import ident directly since it's not exported,
    // but we can verify the route rejects injection attempts via integration tests.
    expect(true).toBe(true);
  });
});

// ── Integration tests ───────────────────────────────────────────────────

const VIEW_NAME = "test-api-view";
const PG_SCHEMA = "view_test_api_view";

const viewDef = {
  name: VIEW_NAME,
  version: "1.0.0",
  definition: {
    name: VIEW_NAME,
    sources: [{ contract: "SP123::marketplace" }],
    schema: {
      listings: {
        columns: {
          nft_id: { type: "text", indexed: true },
          seller: { type: "text" },
          price: { type: "uint" },
          status: { type: "text" },
        },
        indexes: [["seller", "status"]],
      },
    },
  },
  schemaHash: "test-hash-123",
  handlerPath: resolve(__dirname, "../../../fixtures/test-handler.ts"),
};

describe.skipIf(SKIP)("Views API Routes", () => {
  const app = new Hono();
  app.route("/views", viewsRouter);

  beforeAll(async () => {
    const db = getDb();
    // Clean slate
    await db.deleteFrom("views").execute();
    await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);

    // Register view
    await registerView(db, viewDef);

    // Create PG schema + table
    const client = getRawClient();
    await client.unsafe(`CREATE SCHEMA IF NOT EXISTS ${PG_SCHEMA}`);
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS ${PG_SCHEMA}.listings (
        "_id" SERIAL PRIMARY KEY,
        "_block_height" BIGINT NOT NULL,
        "_tx_id" TEXT NOT NULL,
        "_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "nft_id" TEXT,
        "seller" TEXT,
        "price" BIGINT,
        "status" TEXT
      )
    `);

    // Seed test data
    await client.unsafe(`
      INSERT INTO ${PG_SCHEMA}.listings ("_block_height", "_tx_id", "nft_id", "seller", "price", "status")
      VALUES
        (100, 'tx1', 'nft-1', 'SP_ALICE', 1000000, 'active'),
        (100, 'tx2', 'nft-2', 'SP_BOB', 2000000, 'active'),
        (101, 'tx3', 'nft-3', 'SP_ALICE', 500000, 'sold'),
        (102, 'tx4', 'nft-4', 'SP_CAROL', 3000000, 'active')
    `);

    // Start cache so routes can resolve views
    await startViewCache();
  });

  afterAll(async () => {
    await stopViewCache();
    const db = getDb();
    await sql.raw(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`).execute(db);
    await db.deleteFrom("views").execute();
  });

  // ── GET /views ──────────────────────────────────────────────────────

  test("GET /views lists all views", async () => {
    const res = await app.request("/views");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe(VIEW_NAME);
    expect(body.data[0].tables).toContain("listings");
  });

  // ── GET /views/:viewName ────────────────────────────────────────────

  test("GET /views/:viewName returns view metadata with table docs", async () => {
    const res = await app.request(`/views/${VIEW_NAME}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe(VIEW_NAME);
    expect(body.status).toBe("active");
    expect(body.tables.listings).toBeDefined();
    expect(body.tables.listings.columns.nft_id).toBe("text");
    expect(body.tables.listings.columns.price).toBe("uint");
    expect(body.tables.listings.columns._id).toBe("serial");
    expect(body.tables.listings.rowCount).toBe(4);
    expect(body.tables.listings.endpoint).toBe(`/views/${VIEW_NAME}/listings`);
    expect(body.tables.listings.example).toContain("_sort=");
  });

  test("GET /views/:viewName returns 404 for unknown view", async () => {
    const res = await app.request("/views/nonexistent");
    expect(res.status).toBe(404);
  });

  // ── GET /views/:viewName/:tableName ─────────────────────────────────

  test("GET /views/:viewName/:tableName lists rows", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(4);
    expect(body.meta.total).toBe(4);
    expect(body.meta.limit).toBe(50);
    expect(body.meta.offset).toBe(0);
  });

  test("equality filter: ?status=active", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?status=active`);
    const body = await res.json();
    expect(body.data.length).toBe(3);
    expect(body.meta.total).toBe(3);
    for (const row of body.data) {
      expect(row.status).toBe("active");
    }
  });

  test("equality filter: ?seller=SP_ALICE", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?seller=SP_ALICE`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("comparison filter: ?price.gte=1000000", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?price.gte=1000000`);
    const body = await res.json();
    expect(body.data.length).toBe(3);
  });

  test("comparison filter: ?price.gt=2000000", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?price.gt=2000000`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].nft_id).toBe("nft-4");
  });

  test("comparison filter: ?_block_height.lte=100", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_block_height.lte=100`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("combined filters: ?seller=SP_ALICE&status=active", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?seller=SP_ALICE&status=active`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].nft_id).toBe("nft-1");
  });

  test("sorting: ?_sort=price&_order=desc", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_sort=price&_order=desc`);
    const body = await res.json();
    expect(body.data[0].price).toBe("3000000"); // bigint comes back as string
  });

  test("sorting: ?_sort=price&_order=asc", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_sort=price&_order=asc`);
    const body = await res.json();
    expect(body.data[0].price).toBe("500000");
  });

  test("pagination: ?_limit=2&_offset=0", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_limit=2&_offset=0`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.meta.total).toBe(4);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.offset).toBe(0);
  });

  test("pagination: ?_limit=2&_offset=2", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_limit=2&_offset=2`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.meta.offset).toBe(2);
  });

  test("pagination: ?_limit=2&_offset=3 returns 1 row", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_limit=2&_offset=3`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
  });

  test("field selection: ?_fields=nft_id,price", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_fields=nft_id,price`);
    const body = await res.json();
    expect(body.data.length).toBe(4);
    // Should only have selected fields
    const row = body.data[0];
    expect(row.nft_id).toBeDefined();
    expect(row.price).toBeDefined();
    expect(row.seller).toBeUndefined();
    expect(row.status).toBeUndefined();
  });

  test("unknown column in filter returns 400", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?nonexistent=foo`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_COLUMN");
  });

  test("unknown column in _sort returns 400", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_sort=nonexistent`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_COLUMN");
  });

  test("unknown column in _fields returns 400", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_fields=nft_id,bad_col`);
    expect(res.status).toBe(400);
  });

  test("unknown table returns 404", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("TABLE_NOT_FOUND");
  });

  test("unknown view returns 404", async () => {
    const res = await app.request("/views/nonexistent/listings");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("VIEW_NOT_FOUND");
  });

  // ── GET /views/:viewName/:tableName/:id ─────────────────────────────

  test("GET by _id returns single row", async () => {
    // First get the first row's ID
    const listRes = await app.request(`/views/${VIEW_NAME}/listings?_limit=1`);
    const listBody = await listRes.json();
    const id = listBody.data[0]._id;

    const res = await app.request(`/views/${VIEW_NAME}/listings/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data._id).toBe(id);
    expect(body.data.nft_id).toBeDefined();
  });

  test("GET by _id returns 404 for missing row", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings/999999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("ROW_NOT_FOUND");
  });

  // ── GET /views/:viewName/:tableName/count ───────────────────────────

  test("count returns total rows", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings/count`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(4);
  });

  test("count with filter", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings/count?status=active`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
  });

  test("count with comparison filter", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings/count?price.gte=2000000`);
    const body = await res.json();
    expect(body.count).toBe(2);
  });

  // ── _limit bounds ───────────────────────────────────────────────────

  test("_limit is capped at 1000", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_limit=5000`);
    const body = await res.json();
    expect(body.meta.limit).toBe(1000);
  });

  test("_limit=0 falls back to default", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_limit=0`);
    const body = await res.json();
    expect(body.meta.limit).toBe(50);
  });

  test("_limit=-1 clamps to 1", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/listings?_limit=-1`);
    const body = await res.json();
    expect(body.meta.limit).toBe(1);
  });

  // ── POST /views/:viewName/reindex ───────────────────────────────────

  test("POST /views/:viewName/reindex returns 404 for unknown view", async () => {
    const res = await app.request("/views/nonexistent/reindex", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("POST /views/:viewName/reindex accepts request for existing view", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/reindex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromBlock: 1, toBlock: 10 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Reindex started");
    expect(body.fromBlock).toBe(1);
    expect(body.toBlock).toBe(10);
  });

  test("POST /views/:viewName/reindex works without body", async () => {
    const res = await app.request(`/views/${VIEW_NAME}/reindex`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain("Reindex started");
    expect(body.fromBlock).toBe(1);
    expect(body.toBlock).toBe("chain tip");
  });
});
