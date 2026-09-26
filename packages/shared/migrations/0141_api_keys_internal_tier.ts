import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

/**
 * Adds the first-party `internal` tier to `api_keys.tier` and moves the
 * workload host's per-tenant `hosted-stack` keys onto it. Those keys are how
 * a hosted webhook evaluator reads Index/Streams; its reads are our cost,
 * billed to the customer per webhook event, so they must not count as the
 * customer's `rows.delivered` (or trip the monthly-allowance 402 that would
 * silently stop their webhooks). Only the workload-host-guarded mint route
 * sets this tier; customers can't.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_tier_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_tier_check
				CHECK (tier IS NULL OR tier IN ('free', 'build', 'scale', 'enterprise', 'internal'))
		`.execute(db);
		await sql`
			UPDATE api_keys SET tier = 'internal'
			WHERE name = 'hosted-stack'
				AND ip_address = 'workload-host'
				AND product = 'account'
				AND tier IS DISTINCT FROM 'internal'
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`SET lock_timeout = '30s'`.execute(db);
	await onControlPlane(async () => {
		await sql`
			UPDATE api_keys SET tier = 'free' WHERE tier = 'internal'
		`.execute(db);
		await sql`
			ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_tier_check
		`.execute(db);
		await sql`
			ALTER TABLE api_keys
				ADD CONSTRAINT api_keys_tier_check
				CHECK (tier IS NULL OR tier IN ('free', 'build', 'scale', 'enterprise'))
		`.execute(db);
	});
}
