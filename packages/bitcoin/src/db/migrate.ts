// Standalone migration runner for this self-contained package (D18) —
// `packages/shared/src/db/migrate.ts` hardcodes its own migrations folder, so
// it can't serve this package's separate database (plan design note).

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	FileMigrationProvider,
	Kysely,
	Migrator,
	NO_MIGRATIONS,
	sql,
} from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

const migrationsFolder = resolve(dirname(import.meta.dir), "../migrations");

export function fileMigrationProvider(): FileMigrationProvider {
	return new FileMigrationProvider({
		fs,
		path: { join },
		migrationFolder: migrationsFolder,
	});
}

function databaseUrl(): string {
	const url = process.env.BITCOIN_DATABASE_URL;
	if (!url) throw new Error("BITCOIN_DATABASE_URL is required");
	return url;
}

// biome-ignore lint/suspicious/noExplicitAny: migrations are schema-agnostic
function openDb(url: string): Kysely<any> {
	const client = postgres(url, { max: 1 });
	return new Kysely({ dialect: new PostgresJSDialect({ postgres: client }) });
}

/** Postgres' `invalid_catalog_name` — the server refused the connection outright ("database <name> does not exist"), before any query could even run. */
function isDatabaseAbsentError(err: unknown): boolean {
	return (
		err instanceof Error && (err as Error & { code?: string }).code === "3D000"
	);
}

/** Postgres' `insufficient_privilege` — the role can't `CREATE DATABASE`. */
function isInsufficientPrivilegeError(err: unknown): boolean {
	return (
		err instanceof Error && (err as Error & { code?: string }).code === "42501"
	);
}

/** Postgres' `duplicate_database` — a concurrent `migrate` created it first. */
function isDuplicateDatabaseError(err: unknown): boolean {
	return (
		err instanceof Error && (err as Error & { code?: string }).code === "42P04"
	);
}

/** The database name from a Postgres connection URL's path (e.g. `"bitcoin"` from `.../bitcoin`). */
export function databaseNameFromUrl(url: string): string {
	const name = new URL(url).pathname.replace(/^\//, "");
	if (!name) throw new Error(`no database name in the URL's path: ${url}`);
	return name;
}

/** Quotes `name` as a Postgres identifier (doubling any embedded `"`) — `CREATE DATABASE` takes no bound parameter, so this is the one place a name is interpolated directly into SQL. */
function quoteIdentifier(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Self-provisions `url`'s database when it doesn't exist yet (plan 062,
 * round 1 fix): an *existing* oss install that pulls this update gets
 * `BITCOIN_DATABASE_URL` pointed at a `bitcoin` database that was never
 * created — the postgres init script that creates it
 * (`docker/oss/postgres-init/`) only runs on a brand-new volume, so an
 * upgraded instance's `bitcoin` database simply isn't there. Connects to the
 * same server's `postgres` maintenance database with the same credentials
 * and issues `CREATE DATABASE`, so `migrate` self-heals instead of failing
 * forever. A `42P04` (`duplicate_database`) — a concurrent `migrate` on
 * another replica created it first — is treated as success, not an error.
 */
export async function createDatabaseIfMissing(url: string): Promise<void> {
	const name = databaseNameFromUrl(url);
	const adminUrl = new URL(url);
	adminUrl.pathname = "/postgres";

	const admin = postgres(adminUrl.toString(), { max: 1 });
	try {
		await admin.unsafe(`CREATE DATABASE ${quoteIdentifier(name)}`);
		console.log(
			`created database ${quoteIdentifier(name)} (it didn't exist yet)`,
		);
	} catch (err) {
		if (isDuplicateDatabaseError(err)) return;
		if (isInsufficientPrivilegeError(err)) {
			const quoted = quoteIdentifier(name);
			throw new Error(
				[
					`database ${quoted} doesn't exist, and this role can't create it`,
					`(missing CREATEDB). Fix: either run "CREATE DATABASE ${quoted};"`,
					`yourself, or grant the role CREATEDB ("ALTER ROLE <role> CREATEDB;"),`,
					"then re-run migrate.",
				].join(" "),
			);
		}
		throw err;
	} finally {
		await admin.end();
	}
}

export async function migrateToLatest(): Promise<void> {
	const url = databaseUrl();
	let db = openDb(url);

	try {
		await sql`SET lock_timeout = '30s'`.execute(db);
	} catch (err) {
		await db.destroy();
		if (!isDatabaseAbsentError(err)) throw err;
		await createDatabaseIfMissing(url);
		db = openDb(url);
		await sql`SET lock_timeout = '30s'`.execute(db);
	}
	await sql`SET statement_timeout = '60s'`.execute(db);

	const migrator = new Migrator({ db, provider: fileMigrationProvider() });
	const { error, results } = await migrator.migrateToLatest();

	for (const r of results ?? []) {
		if (r.status === "Success") console.log(`✅ ${r.migrationName}`);
		else if (r.status === "Error") console.error(`❌ ${r.migrationName}`);
		else console.warn(`⏭️  ${r.migrationName} (not executed)`);
	}

	await db.destroy();

	if (error) throw error;
}

export async function migrateDown(): Promise<void> {
	const db = openDb(databaseUrl());
	const migrator = new Migrator({ db, provider: fileMigrationProvider() });

	const { error, results } = await migrator.migrateTo(NO_MIGRATIONS);

	for (const r of results ?? []) {
		if (r.status === "Success") console.log(`✅ reverted ${r.migrationName}`);
		else if (r.status === "Error") console.error(`❌ ${r.migrationName}`);
	}

	await db.destroy();

	if (error) throw error;
}

if (import.meta.main) {
	migrateToLatest().catch((error) => {
		console.error("❌ migration failed:", error);
		process.exit(1);
	});
}
