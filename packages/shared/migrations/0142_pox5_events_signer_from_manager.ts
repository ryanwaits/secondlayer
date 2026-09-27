import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Backfill: `claim-rewards`, `claim-staker-rewards-for-signer`,
 * `grant-signer-key`, and `revoke-signer-grant` only ever printed
 * `signer-manager` — never `signer` — even though the contract's own
 * assertions make it the same principal (see the pox-5 decoder's
 * `promoteTopicFields` comment). Rows decoded before that derivation shipped
 * are missing `signer` on these four topics; fill it from `signer_manager` so
 * `signer=` returns a pool's complete pox-5 activity for old rows too.
 *
 * Idempotent by its WHERE (only touches rows still missing `signer`), so it
 * is safe to run more than once.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`
			UPDATE pox5_events
			SET signer = signer_manager
			WHERE signer IS NULL
				AND signer_manager IS NOT NULL
				AND topic IN (
					'claim-rewards',
					'claim-staker-rewards-for-signer',
					'grant-signer-key',
					'revoke-signer-grant'
				)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`
			UPDATE pox5_events
			SET signer = NULL
			WHERE topic IN (
				'claim-rewards',
				'claim-staker-rewards-for-signer',
				'grant-signer-key',
				'revoke-signer-grant'
			)
		`.execute(db);
	});
}
