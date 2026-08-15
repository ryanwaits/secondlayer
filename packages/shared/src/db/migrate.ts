import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	FileMigrationProvider,
	Kysely,
	type MigrationProvider,
	type MigrationResultSet,
	Migrator,
	sql,
} from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { type MigrationRole, setMigrationRole } from "./migration-role.ts";
import type { Database } from "./types.ts";

const migrationsFolder = resolve(dirname(import.meta.dir), "../migrations");

export interface MigrationTarget {
	url: string;
	/** DB plane this pass targets — gates control/chain DDL via migration-role helpers. */
	role: MigrationRole;
}

/**
 * The distinct databases to migrate, each tagged with its plane role. In
 * single-DB mode (`DATABASE_URL` only) or a collapsed split (`SOURCE`===`TARGET`)
 * this is one URL with role `'both'` — every migration helper runs, identical to
 * pre-split behavior. With the chain/control split configured (distinct
 * `SOURCE_DATABASE_URL`/`TARGET_DATABASE_URL`) it's both URLs, role `'source'`
 * and `'target'`: every migration still runs on each (kysely integrity), but its
 * DDL is gated by `onControlPlane`/`onChainPlane` so control DDL no-ops on SOURCE
 * (where those tables were dropped) and vice-versa.
 */
export function migrationTargets(): MigrationTarget[] {
	const source = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
	const target = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
	// Single-DB / collapsed split → one pass, role 'both'.
	if (source && target && source === target) {
		return [{ url: source, role: "both" }];
	}
	const out: MigrationTarget[] = [];
	if (source) out.push({ url: source, role: "source" });
	if (target) out.push({ url: target, role: "target" });
	return out;
}

/** The on-disk migration set (`packages/shared/migrations`), in filename order. */
export function fileMigrationProvider(): MigrationProvider {
	return new FileMigrationProvider({
		fs,
		path: { join },
		migrationFolder: migrationsFolder,
	});
}

/** Every migration name in execution order, without touching a database. */
export async function migrationNames(): Promise<string[]> {
	const migrations = await fileMigrationProvider().getMigrations();
	return Object.keys(migrations).sort();
}

export interface FileMigrationOptions {
	/**
	 * Apply migrations only up to and including this name instead of running to
	 * latest. Deploys always run to latest; partial application exists so an
	 * upgrade can be reproduced faithfully — build a database at a released
	 * revision, then finish it — which is what the schema-parity proof needs.
	 */
	through?: string;
}

/**
 * Apply the on-disk migrations to `db`. Returns kysely's result set rather than
 * throwing so callers decide how loud to be about a failure.
 */
export function runFileMigrations<DB>(
	db: Kysely<DB>,
	options: FileMigrationOptions = {},
): Promise<MigrationResultSet> {
	const migrator = new Migrator({
		db: db as Kysely<unknown>,
		provider: fileMigrationProvider(),
	});
	return options.through === undefined
		? migrator.migrateToLatest()
		: migrator.migrateTo(options.through);
}

export async function runMigrations() {
	const targets = migrationTargets();
	if (targets.length === 0) {
		console.error(
			"❌ DATABASE_URL (or SOURCE_DATABASE_URL/TARGET_DATABASE_URL) is required",
		);
		process.exit(1);
	}

	for (const [i, { url, role }] of targets.entries()) {
		if (targets.length > 1) {
			console.log(
				`\n🗄️  Migrating database ${i + 1}/${targets.length} (role=${role})`,
			);
		}
		setMigrationRole(role);
		await migrateOne(url);
	}
}

async function migrateOne(connectionString: string) {
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

	try {
		const { error, results } = await runFileMigrations(db);
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
		if (!import.meta.main) throw error;
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

// Only run when executed directly (`bun run …/migrate.ts`), not when imported
// (tests import `migrationTargets`).
if (import.meta.main) {
	runMigrations();
}
