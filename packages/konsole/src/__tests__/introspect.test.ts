import { describe, expect, test, afterAll } from "bun:test";
import { connectDb } from "../db.ts";
import { introspectSchema } from "../schema/introspect.ts";

const url = process.env.DATABASE_URL || "postgresql://ryanwaits@127.0.0.1:5432/streams_dev";
const { db, close } = connectDb(url);

afterAll(async () => {
  await close();
});

describe("introspectSchema", () => {
  test("discovers tables", async () => {
    const schema = await introspectSchema(db);
    expect(schema.tables.size).toBeGreaterThan(0);
    // Should have common tables
    expect(schema.tables.has("accounts")).toBe(true);
  });

  test("tables have columns", async () => {
    const schema = await introspectSchema(db);
    const accounts = schema.tables.get("accounts");
    expect(accounts).toBeDefined();
    expect(accounts!.columns.length).toBeGreaterThan(0);
    const colNames = accounts!.columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("email");
  });

  test("tables have primary keys", async () => {
    const schema = await introspectSchema(db);
    const accounts = schema.tables.get("accounts");
    expect(accounts!.primaryKey).toBe("id");
  });

  test("discovers foreign keys", async () => {
    const schema = await introspectSchema(db);
    expect(schema.foreignKeys.length).toBeGreaterThan(0);
    // api_keys → accounts FK should exist
    const fk = schema.foreignKeys.find(
      (f) => f.fromTable === "api_keys" && f.toTable === "accounts",
    );
    expect(fk).toBeDefined();
    expect(fk!.fromColumn).toBe("account_id");
  });

  test("skips migration tables", async () => {
    const schema = await introspectSchema(db);
    expect(schema.tables.has("kysely_migration")).toBe(false);
    expect(schema.tables.has("kysely_migration_lock")).toBe(false);
  });

  test("column info is populated", async () => {
    const schema = await introspectSchema(db);
    const accounts = schema.tables.get("accounts")!;
    const idCol = accounts.columns.find((c) => c.name === "id")!;
    expect(idCol.isPrimaryKey).toBe(true);
    expect(idCol.nullable).toBe(false);
    expect(idCol.hasDefault).toBe(true);

    const emailCol = accounts.columns.find((c) => c.name === "email")!;
    expect(emailCol.isPrimaryKey).toBe(false);
    expect(emailCol.dataType).toBeDefined();
  });
});
