import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./types.ts";

let db: Kysely<Database> | null = null;
let rawClient: ReturnType<typeof postgres> | null = null;

export function getDb(connectionString?: string): Kysely<Database> {
  if (!db) {
    const url = connectionString || process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/streams_dev";

    // Always use SSL for remote databases, just disable cert verification if needed
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1") || url.includes("@postgres:");
    rawClient = postgres(url, {
      ssl: isLocal ? undefined : { rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0" },
    });
    db = new Kysely<Database>({
      dialect: new PostgresJSDialect({ postgres: rawClient }),
    });
  }
  return db;
}

/** Raw postgres.js client for dynamic schema DDL (CREATE SCHEMA, DROP, etc.) */
export function getRawClient(): ReturnType<typeof postgres> {
  if (!rawClient) getDb();
  return rawClient!;
}

/** Close the DB connection pool. Call in CLI commands to allow process exit. */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
  if (rawClient) {
    await rawClient.end();
    rawClient = null;
  }
}

import { sql } from "kysely";
export { sql };
export * from "./types.ts";
export { jsonb, parseJsonb } from "./jsonb.ts";
