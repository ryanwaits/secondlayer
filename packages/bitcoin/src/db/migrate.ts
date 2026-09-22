// Standalone migration runner for this self-contained package (D18) —
// `packages/shared/src/db/migrate.ts` hardcodes its own migrations folder, so
// it can't serve this package's separate database (plan design note).

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FileMigrationProvider, Kysely, Migrator, sql } from "kysely";
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
function openDb(): Kysely<any> {
	const client = postgres(databaseUrl(), { max: 1 });
	return new Kysely({ dialect: new PostgresJSDialect({ postgres: client }) });
}

export async function migrateToLatest(): Promise<void> {
	const db = openDb();
	const migrator = new Migrator({ db, provider: fileMigrationProvider() });

	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`SET statement_timeout = '60s'`.execute(db);

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
	const db = openDb();
	const migrator = new Migrator({ db, provider: fileMigrationProvider() });

	const { error, results } = await migrator.migrateTo("NO_MIGRATIONS");

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
