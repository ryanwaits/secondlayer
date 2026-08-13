import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Local instance identity — one row per database, network immutable.
 *
 * Self-host has no account. This is the identity root: later auth, namespace,
 * and bootstrap hang off it instead of `accounts`. Hosted/platform keeps
 * accounts; this table still exists there as the publisher's network pin.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			CREATE TABLE instances (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				network TEXT NOT NULL
					CHECK (network IN ('mainnet', 'testnet', 'devnet')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
		// At most one instance per database.
		await sql`
			CREATE UNIQUE INDEX instances_singleton ON instances ((TRUE))
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`DROP TABLE IF EXISTS instances`.execute(db);
	});
}
