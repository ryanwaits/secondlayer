import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Verifiable subgraphs, deploy-time identity and level.
 *
 * - `subgraphs.pin`: sha256 over schema_hash, the bundled handler, startBlock,
 *   network and runtime version. Changes whenever anything that shapes rows
 *   does, unlike schema_hash. NULL for local (unbundled) deploys and rows
 *   deployed before this column existed.
 * - `subgraphs.verification`: the level derived from sources and the handler
 *   scan (`{ level, verifiable, reasons, unproven }`). NULL = deployed before
 *   derivation existed; the runtime treats it as not verifiable, so existing
 *   subgraphs keep today's execution path.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
				ADD COLUMN IF NOT EXISTS pin TEXT,
				ADD COLUMN IF NOT EXISTS verification JSONB
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE subgraphs
				DROP COLUMN IF EXISTS verification,
				DROP COLUMN IF EXISTS pin
		`.execute(db);
	});
}
