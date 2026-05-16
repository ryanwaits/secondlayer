import { type Kysely, sql } from "kysely";

/**
 * Mark the `tenants` table deprecated. The 2026-05-14 shared-rip pivot
 * collapsed the dedicated per-tenant model — no live writers remain. Rows
 * are preserved here for post-pivot reconciliation. A follow-up migration
 * will `DROP TABLE` after a 2-cycle observation window when we're sure no
 * Stripe-dormant reader references `tenants.plan`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		COMMENT ON TABLE tenants IS
			'DEPRECATED 2026-05-16: post shared-rip, no live writers. Drop after observation window.'
	`.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// No-op — restoring the comment to nothing on rollback is not useful.
}
