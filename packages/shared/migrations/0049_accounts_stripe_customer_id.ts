import { type Kysely, sql } from "kysely";

/**
 * Link accounts to Stripe customers.
 *
 * Nullable because we create the Stripe customer lazily — only when an
 * account upgrades past Hobby. Hobby users never show up in Stripe, which
 * keeps the dashboard clean and avoids Stripe-side overhead per free user.
 *
 * Unique index (not constraint) so the column stays nullable but still
 * enforces one-to-one when set.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE accounts
			ADD COLUMN IF NOT EXISTS stripe_customer_id text
	`.execute(db);
	await sql`
		CREATE UNIQUE INDEX IF NOT EXISTS accounts_stripe_customer_idx
			ON accounts (stripe_customer_id)
			WHERE stripe_customer_id IS NOT NULL
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS accounts_stripe_customer_idx`.execute(db);
	await sql`
		ALTER TABLE accounts DROP COLUMN IF EXISTS stripe_customer_id
	`.execute(db);
}
