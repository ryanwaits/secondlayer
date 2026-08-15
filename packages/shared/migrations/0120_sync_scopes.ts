import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * `sync_scopes` — the instance's declared scope: network, where its history
 * starts, and how that history got here.
 *
 * Without a recorded start, "everything below the lowest stored block" is
 * indistinguishable from data loss: a forward-only instance reads as a chain
 * with an 8M-block hole. The row makes the absence deliberate, so the coverage
 * evaluator can call the prefix `out_of_scope` instead of a gap.
 *
 * One row per network (the network is the primary key) and it lives on the
 * source plane, next to the chain whose scope it declares.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE sync_scopes (
				network TEXT PRIMARY KEY,
				start_height BIGINT NOT NULL CHECK (start_height >= 0),
				target_height BIGINT,
				bootstrap_source TEXT NOT NULL
					CHECK (bootstrap_source IN ('archive', 'genesis', 'import')),
				bootstrap_manifest_digest TEXT,
				genesis_hash TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT sync_scopes_target_above_start
					CHECK (target_height IS NULL OR target_height >= start_height)
			)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS sync_scopes`.execute(db);
	});
}
