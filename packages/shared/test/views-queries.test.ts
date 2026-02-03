import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { getDb } from "../src/db/index.ts";
import { sql } from "kysely";
import { registerView, getView, listViews, updateViewStatus, deleteView } from "../src/db/queries/views.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("Views Queries", () => {
  const testDef = {
    name: "test-view",
    version: "1.0.0",
    definition: { name: "test-view", sources: [{ contract: "SP::c" }], schema: {} },
    schemaHash: "abc123",
    handlerPath: "/tmp/test-view.ts",
  };

  afterEach(async () => {
    const db = getDb();
    await db.deleteFrom("views").execute();
    // Clean up any PG schemas we created
    await sql.raw("DROP SCHEMA IF EXISTS view_test_view CASCADE").execute(db);
  });

  afterAll(async () => {
    const db = getDb();
    await db.deleteFrom("views").execute();
  });

  test("registerView inserts a new view", async () => {
    const db = getDb();
    const view = await registerView(db, testDef);

    expect(view.id).toBeDefined();
    expect(view.name).toBe("test-view");
    expect(view.version).toBe("1.0.0");
    expect(view.status).toBe("active");
    expect(view.schema_hash).toBe("abc123");
    expect(view.handler_path).toBe("/tmp/test-view.ts");
    expect(Number(view.last_processed_block)).toBe(0);
  });

  test("registerView upserts on conflict", async () => {
    const db = getDb();
    await registerView(db, testDef);
    const updated = await registerView(db, { ...testDef, schemaHash: "def456", version: "2.0.0" });

    expect(updated.schema_hash).toBe("def456");
    expect(updated.version).toBe("2.0.0");

    // Should still be one row
    const all = await listViews(db);
    expect(all.length).toBe(1);
  });

  test("getView returns view by name", async () => {
    const db = getDb();
    await registerView(db, testDef);

    const view = await getView(db, "test-view");
    expect(view).not.toBeNull();
    expect(view!.name).toBe("test-view");
  });

  test("getView returns null for unknown name", async () => {
    const db = getDb();
    const view = await getView(db, "nonexistent");
    expect(view).toBeNull();
  });

  test("listViews returns all views", async () => {
    const db = getDb();
    await registerView(db, testDef);
    await registerView(db, { ...testDef, name: "second-view" });

    const all = await listViews(db);
    expect(all.length).toBe(2);
  });

  test("updateViewStatus changes status", async () => {
    const db = getDb();
    await registerView(db, testDef);

    await updateViewStatus(db, "test-view", "error");
    const view = await getView(db, "test-view");
    expect(view!.status).toBe("error");
  });

  test("updateViewStatus updates last_processed_block", async () => {
    const db = getDb();
    await registerView(db, testDef);

    await updateViewStatus(db, "test-view", "active", 5000);
    const view = await getView(db, "test-view");
    expect(Number(view!.last_processed_block)).toBe(5000);
  });

  test("deleteView removes view and drops schema", async () => {
    const db = getDb();
    await registerView(db, testDef);

    // Create the PG schema so deleteView has something to drop
    await sql.raw("CREATE SCHEMA IF NOT EXISTS view_test_view").execute(db);

    const deleted = await deleteView(db, "test-view");
    expect(deleted).not.toBeNull();
    expect(deleted!.name).toBe("test-view");

    const view = await getView(db, "test-view");
    expect(view).toBeNull();
  });

  test("deleteView returns null for unknown view", async () => {
    const db = getDb();
    const result = await deleteView(db, "nonexistent");
    expect(result).toBeNull();
  });
});
