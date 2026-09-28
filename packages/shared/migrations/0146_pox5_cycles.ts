import { type Kysely, sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

// Materialized per-cycle PoX-5 rollup — the output of `rollupPox5Cycles`
// (packages/indexer/src/decode/pox5-cycles.ts), maintained after every
// committed pox5 decoder batch and after a pox5 reorg. `pox5_events` is the
// source of truth; these tables only cache the derived per-cycle totals the
// read API serves, so both are fully rebuildable via
// `rebuild-pox5-cycles.ts --apply`.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS pox5_cycles (
				reward_cycle INTEGER PRIMARY KEY,
				start_burn_height BIGINT NOT NULL,
				prepare_start_burn_height BIGINT NOT NULL,
				end_burn_height BIGINT NOT NULL,
				total_stacked_ustx NUMERIC NOT NULL,
				reward_eligible_ustx NUMERIC NOT NULL,
				stakers INTEGER NOT NULL,
				signers_in_set INTEGER NOT NULL,
				bond_sats JSONB NOT NULL DEFAULT '{}'::jsonb,
				bond_total_sats NUMERIC NOT NULL,
				sbtc_custodied_sats NUMERIC NOT NULL,
				rewards_allocated_stx NUMERIC NOT NULL,
				rewards_allocated_bond NUMERIC NOT NULL,
				reserve_deposit NUMERIC NOT NULL,
				rewards_per_token_stx NUMERIC,
				rewards_per_token_bond JSONB NOT NULL DEFAULT '{}'::jsonb,
				distributions INTEGER NOT NULL,
				rewards_claimed NUMERIC NOT NULL,
				computed_through_height BIGINT NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);

		await sql`
			CREATE TABLE IF NOT EXISTS pox5_cycle_signers (
				reward_cycle INTEGER NOT NULL,
				signer TEXT NOT NULL,
				delegated_ustx NUMERIC NOT NULL,
				stx_only_ustx NUMERIC NOT NULL,
				reward_shares_ustx NUMERIC NOT NULL,
				in_set BOOLEAN NOT NULL,
				rewards_claimed NUMERIC NOT NULL,
				PRIMARY KEY (reward_cycle, signer)
			)
		`.execute(db);

		await sql`CREATE INDEX IF NOT EXISTS pox5_cycle_signers_signer_idx ON pox5_cycle_signers (signer)`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS pox5_cycle_signers`.execute(db);
		await sql`DROP TABLE IF EXISTS pox5_cycles`.execute(db);
	});
}
