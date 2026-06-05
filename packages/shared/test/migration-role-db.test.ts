import { afterEach, describe, expect, test } from "bun:test";
import { type Kysely, type MigrationProvider, Migrator, sql } from "kysely";
import {
	type MigrationRole,
	onChainPlane,
	onControlPlane,
	setMigrationRole,
} from "../src/db/migration-role.ts";
import {
	createTestDatabase,
	createTestDb,
	dropTestDatabase,
} from "../src/db/test-helpers.ts";
import type { Database } from "../src/db/types.ts";

/**
 * End-to-end proof that the role helpers gate DDL through a REAL kysely Migrator
 * + real Postgres: a single migration creates a control probe table via
 * `onControlPlane` and a chain probe via `onChainPlane`; the role set before
 * `migrateToLatest()` decides which actually lands. Gated on a base DB the test
 * can `CREATE DATABASE` against (local: `127.0.0.1:5435`).
 */
const HAS_DB = !!process.env.DATABASE_URL;

// One migration that probes both planes. Under the split a control migration's
// up() is exactly this shape (control DDL wrapped, chain DDL wrapped).
const probeProvider: MigrationProvider = {
	async getMigrations() {
		return {
			"0001_role_probe": {
				async up(db: Kysely<unknown>) {
					await onControlPlane(() =>
						sql`CREATE TABLE _role_probe_ctl (id int)`
							.execute(db)
							.then(() => {}),
					);
					await onChainPlane(() =>
						sql`CREATE TABLE _role_probe_chain (id int)`
							.execute(db)
							.then(() => {}),
					);
				},
			},
		};
	},
};

async function tableExists(
	db: Kysely<Database>,
	name: string,
): Promise<boolean> {
	const { rows } = await sql<{ exists: boolean }>`
		SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS exists
	`.execute(db);
	return rows[0]?.exists ?? false;
}

async function runProbe(
	role: MigrationRole,
): Promise<{ ctl: boolean; chain: boolean }> {
	const url = await createTestDatabase();
	const db = createTestDb(url);
	try {
		setMigrationRole(role);
		const { error } = await new Migrator({
			db,
			provider: probeProvider,
		}).migrateToLatest();
		if (error) throw error;
		return {
			ctl: await tableExists(db, "_role_probe_ctl"),
			chain: await tableExists(db, "_role_probe_chain"),
		};
	} finally {
		await db.destroy();
		await dropTestDatabase(url);
	}
}

describe.skipIf(!HAS_DB)("migration-role DDL gating (DB)", () => {
	afterEach(() => setMigrationRole("both"));

	test("role 'source' lands chain probe only", async () => {
		expect(await runProbe("source")).toEqual({ ctl: false, chain: true });
	});

	test("role 'target' lands control probe only", async () => {
		expect(await runProbe("target")).toEqual({ ctl: true, chain: false });
	});

	test("role 'both' (single-DB) lands both probes", async () => {
		expect(await runProbe("both")).toEqual({ ctl: true, chain: true });
	});
});
