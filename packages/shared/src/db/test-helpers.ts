import postgres from "postgres";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import type { Database } from "./types.ts";

let testDbCounter = 0;

/**
 * Creates an isolated test database.
 * Returns the connection URL for the new database.
 */
export async function createTestDatabase(): Promise<string> {
  const baseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres";
  const dbName = `streams_test_${Date.now()}_${++testDbCounter}`;

  const client = postgres(baseUrl, { max: 1 });
  try {
    await client.unsafe(`CREATE DATABASE ${dbName}`);
  } finally {
    await client.end();
  }

  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Drops a test database.
 */
export async function dropTestDatabase(dbUrl: string): Promise<void> {
  const url = new URL(dbUrl);
  const dbName = url.pathname.slice(1);

  const baseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres";
  const client = postgres(baseUrl, { max: 1 });

  try {
    await client.unsafe(`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = '${dbName}'
      AND pid <> pg_backend_pid()
    `);
    await client.unsafe(`DROP DATABASE IF EXISTS ${dbName}`);
  } finally {
    await client.end();
  }
}

/**
 * Truncates all tables in the database.
 */
export async function resetTables(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");

  const client = postgres(dbUrl);
  try {
    await client`TRUNCATE TABLE deliveries, jobs, events, transactions, blocks, streams, index_progress RESTART IDENTITY CASCADE`;
  } finally {
    await client.end();
  }
}

/**
 * Creates a Kysely instance for testing.
 */
export function createTestDb(dbUrl: string): Kysely<Database> {
  const client = postgres(dbUrl);
  return new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: client }),
  });
}
