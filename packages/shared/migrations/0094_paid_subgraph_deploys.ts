import { sql } from "kysely";
import type { Kysely } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * x402-paid subgraph deploys (agent-owned indexers).
 *
 * - `accounts.wallet_principal`: a Stacks principal that owns a wallet-ghost
 *   account — the identity behind accountless paid deploys. One account per
 *   principal (partial unique; NULL for every other account).
 * - `subgraphs.expires_at`: paid deploys live for a bounded window unless
 *   renewed (paid) or the owning account is claimed; NULL = no expiry
 *   (every non-paid subgraph).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE accounts ADD COLUMN wallet_principal TEXT`.execute(
			db,
		);
		await sql`CREATE UNIQUE INDEX accounts_wallet_principal_uidx ON accounts (wallet_principal) WHERE wallet_principal IS NOT NULL`.execute(
			db,
		);
		await sql`ALTER TABLE subgraphs ADD COLUMN expires_at TIMESTAMPTZ`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE subgraphs DROP COLUMN IF EXISTS expires_at`.execute(
			db,
		);
		await sql`DROP INDEX IF EXISTS accounts_wallet_principal_uidx`.execute(db);
		await sql`ALTER TABLE accounts DROP COLUMN IF EXISTS wallet_principal`.execute(
			db,
		);
	});
}
