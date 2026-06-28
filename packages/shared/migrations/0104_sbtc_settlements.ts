import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * BTC L1 settlement status for sBTC withdrawal sweeps (chain plane / SOURCE).
 *
 * sBTC `withdrawal-accept` events carry a `sweep_txid` — the Bitcoin tx the
 * signers committed to broadcast — but the Stacks side never proves the sweep
 * CONFIRMED on Bitcoin. The indexer's settlement-confirmer worker polls our own
 * bitcoind for each sweep's confirmation count and records it here, so the API's
 * withdrawal lifecycle can report real `btc_confirmations` / `settlement_confirmed`
 * instead of a null placeholder.
 *
 * Keyed on `sweep_txid` (PK), not `request_id`: a request can produce more than
 * one sweep over its life (RBF / signer rebroadcast under a new btc txid), and
 * keying on the sweep preserves each broadcast's confirmation history rather than
 * destructively overwriting on replacement. The S3 API LEFT JOIN selects by the
 * indexed `request_id`.
 *
 * Two indexes: `request_id` for that join; a partial index on `last_checked_at`
 * scoped to unconfirmed rows for the worker's "least-recently-checked first" drain.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`
			CREATE TABLE IF NOT EXISTS sbtc_settlements (
				sweep_txid           TEXT PRIMARY KEY,
				request_id           BIGINT NOT NULL,
				btc_confirmations    INTEGER NOT NULL DEFAULT 0,
				settlement_confirmed BOOLEAN NOT NULL DEFAULT false,
				block_hash           TEXT,
				block_height         INTEGER,
				first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
				last_checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
				confirmed_at         TIMESTAMPTZ,
				updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS sbtc_settlements_request_id_idx
				ON sbtc_settlements (request_id)
		`.execute(db);
		await sql`
			CREATE INDEX IF NOT EXISTS sbtc_settlements_pending_idx
				ON sbtc_settlements (last_checked_at)
				WHERE settlement_confirmed = false
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP TABLE IF EXISTS sbtc_settlements`.execute(db);
	});
}
