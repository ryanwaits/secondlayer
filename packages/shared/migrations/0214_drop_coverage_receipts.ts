import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// Per-block coverage receipts were written on every decoder commit but never
// read, and nothing ever wrote `coverage_segments` or `stage_runs`.
// `stage_failures` and `stage_registry` stay: they are the durable fault
// record. Chain-plane only; every step is a no-op when its table is absent.
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onChainPlane(async () => {
		// Dropping run_id also drops its foreign key to stage_runs.
		await sql`ALTER TABLE IF EXISTS stage_failures DROP COLUMN IF EXISTS run_id`.execute(
			db,
		);
		// Receipts reference stage_runs, so they go before it.
		await sql`DROP TABLE IF EXISTS stage_block_receipts`.execute(db);
		await sql`DROP TABLE IF EXISTS coverage_segments`.execute(db);
		await sql`DROP TABLE IF EXISTS stage_runs`.execute(db);
	});
}

// No-op: the receipts were never read. 0116_coverage_schema documents the
// original DDL.
export async function down(_db: Kysely<unknown>): Promise<void> {}
