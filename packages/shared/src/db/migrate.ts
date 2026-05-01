import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FileMigrationProvider, Kysely, Migrator, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { Database } from "./types.ts";

const migrationsFolder = resolve(dirname(import.meta.dir), "../migrations");

async function runMigrations() {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		console.error("❌ DATABASE_URL environment variable is required");
		process.exit(1);
	}

	console.log("🔄 Running migrations...");

	const client = postgres(connectionString, { max: 1 });
	const db = new Kysely<Database>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});

	// Fail fast on stuck operations: prevents silent CI hangs waiting on advisory
	// locks, table locks, or long-running queries. Every migration step must
	// complete within the timeout — DDL on live tables should take < 1s in the
	// common case. Raise this if a specific migration is known to need longer.
	await sql`SET lock_timeout = '30s'`.execute(db);
	await sql`SET statement_timeout = '60s'`.execute(db);
	await sql`SET idle_in_transaction_session_timeout = '60s'`.execute(db);

	// Snapshot current migration state + pg_stat_activity so if we hang or fail
	// the deploy logs show what was already applied vs. pending, plus what
	// other sessions might be blocking us.
	try {
		const { rows: applied } = await sql<{
			name: string;
			executed_at: Date;
		}>`SELECT name, executed_at FROM kysely_migration ORDER BY name`.execute(
			db,
		);
		console.log(`📋 ${applied.length} migrations already applied`);
		if (applied.length > 0) {
			console.log(`   last: ${applied[applied.length - 1].name}`);
		}
	} catch {
		// kysely_migration table may not exist yet on first run
		console.log("📋 no kysely_migration table yet (first run)");
	}

	const migrator = new Migrator({
		db,
		provider: new FileMigrationProvider({
			fs,
			path: { join },
			migrationFolder: migrationsFolder,
		}),
	});

	try {
		const { error, results } = await migrator.migrateToLatest();
		for (const r of results ?? []) {
			if (r.status === "Success") console.log(`✅ ${r.migrationName}`);
			else if (r.status === "Error") console.error(`❌ ${r.migrationName}`);
			else if (r.status === "NotExecuted")
				console.warn(`⏭️  ${r.migrationName} (not executed — earlier failure)`);
		}
		if (error) throw error;
		console.log("✅ Migrations completed successfully");
	} catch (error) {
		console.error("❌ Migration failed:", error);
		// Dump active sessions on failure to diagnose lock contention remotely.
		try {
			const { rows } = await sql<{
				pid: number;
				state: string;
				wait_event_type: string | null;
				wait_event: string | null;
				query: string;
			}>`
				SELECT pid, state, wait_event_type, wait_event, query
				FROM pg_stat_activity
				WHERE datname = current_database() AND pid <> pg_backend_pid()
			`.execute(db);
			console.error("🔎 active sessions at failure time:");
			for (const r of rows) {
				console.error(
					`  pid=${r.pid} state=${r.state} wait=${r.wait_event_type ?? "none"}/${r.wait_event ?? "none"} query=${r.query.slice(0, 100)}`,
				);
			}
		} catch (diagErr) {
			console.error("(diagnostic query failed)", diagErr);
		}
		process.exit(1);
	} finally {
		await db.destroy();
	}
}

runMigrations();
