import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./types.ts";

let testDbCounter = 0;

/**
 * Creates an isolated test database.
 * Returns the connection URL for the new database.
 */
export async function createTestDatabase(): Promise<string> {
	const baseUrl =
		process.env.DATABASE_URL ||
		"postgresql://postgres:postgres@localhost:5432/postgres";
	const dbName = `secondlayer_test_${Date.now()}_${++testDbCounter}`;

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

	const baseUrl =
		process.env.DATABASE_URL ||
		"postgresql://postgres:postgres@localhost:5432/postgres";
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
		await client`TRUNCATE TABLE events, transactions, blocks, index_progress RESTART IDENTITY CASCADE`;
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

/**
 * Gate for a database-backed suite — and a tripwire for CI.
 *
 * `describe.skipIf(!HAS_DB)` is the right ergonomics locally: a contributor
 * without Postgres running should not see a wall of red. It is the wrong
 * behaviour in CI, where a skip is indistinguishable from a pass. If the
 * Postgres service ever fails to start or `DATABASE_URL` is misconfigured,
 * every database-backed suite in the repo goes green by skipping — and the
 * proofs that matter most (sink atomicity, advisory locking, reorg rollback)
 * are exactly the ones that stop running.
 *
 * So: skip when there is no database and no CI. Fail loudly when CI says a
 * database was supposed to be there.
 *
 *   describe.skipIf(!hasTestDb("kysely sink"))("…", () => { … })
 */
export function hasTestDb(suiteName: string): boolean {
	const configured = !!process.env.DATABASE_URL;
	if (!configured && process.env.CI) {
		throw new Error(
			`${suiteName}: DATABASE_URL is unset in CI. A database-backed suite must not skip here — a silent skip reports success for tests that never ran. Check the Postgres service and DATABASE_URL in the workflow.`,
		);
	}
	return configured;
}
