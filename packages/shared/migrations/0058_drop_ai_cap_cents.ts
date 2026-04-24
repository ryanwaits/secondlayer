import { type Kysely, sql } from "kysely";

/**
 * Drops `account_spend_caps.ai_cap_cents`. AI eval tracking + caps were
 * removed from the product post-pivot (subgraphs + subscriptions only).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE account_spend_caps
			DROP COLUMN IF EXISTS ai_cap_cents
	`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	throw new Error("0058 is a one-way drop; restore from backup");
}
