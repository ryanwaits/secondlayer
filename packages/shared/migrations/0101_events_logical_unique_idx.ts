import type { Kysely } from "kysely";
import { sql } from "kysely";
import { onChainPlane } from "../src/db/migration-role.ts";

/**
 * Unique logical identity for raw `events` (chain plane / SOURCE).
 *
 * The `events` table has only `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
 * and non-unique indexes — nothing enforces that a given on-chain event lands
 * once. `transactions` (PK `tx_id`) and `blocks` (PK `height`) are protected by
 * their primary keys, so their `onConflict(doNothing())` inserts are idempotent;
 * `events` alone degraded to a plain INSERT on every re-ingest because the
 * conflict target did not exist. A non-idempotent `bulk-backfill.ts` re-run over
 * a contiguous window therefore double-inserted whole blocks (every row gets a
 * fresh uuid), producing physical duplicates that the dense `ROW_NUMBER()`
 * stream-ordinal in `readCanonicalStreamsEvents` fanned out into distinct Streams
 * cursors — inflating decoded_events / balance subgraphs (the 2026-06 sBTC
 * supply shortfall: decoded mint−burn read 2,331.6 BTC vs on-chain 2,954.7).
 *
 * The logical key is `(block_height, tx_id, event_index)`:
 *   - `event_index` is per-transaction, so `tx_id` is required to disambiguate.
 *   - `block_height` is included (not implied-redundant) on purpose: a reorg can
 *     legitimately leave the same `(tx_id, event_index)` at two heights (orphan +
 *     canonical). Keying on height permits those as distinct physical rows while
 *     still blocking a true same-height double-insert. `persistBlock` already
 *     delete-by-heights before insert, so it never collides; `bulk-backfill`'s
 *     conflict now fires → DO NOTHING → idempotent.
 *
 * ORDERING — this migration creates a UNIQUE index and therefore REQUIRES the
 * table to already be duplicate-free. On a fresh/dev DB that is trivially true.
 * On prod the historical duplicates (blocks 2,021,105–4,327,077) MUST be deleted
 * FIRST and the index pre-created `CONCURRENTLY` (matching this name exactly), so
 * this migration is a lock-free no-op there via `IF NOT EXISTS`. See the
 * remediation runbook `docs/internal/audits/decoded-events-supply-shortfall-2026-06-15.md`.
 * A blocking build over the full mainnet `events` table would also exceed the
 * default statement_timeout, so lift it for this tx (mirrors 0090).
 *
 * `events` is a chain-plane table → DDL no-ops on the control DB under the split.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`SET LOCAL statement_timeout = 0`.execute(db);
		await sql`
			CREATE UNIQUE INDEX IF NOT EXISTS events_logical_id_uniq
			ON events (block_height, tx_id, event_index)
		`.execute(db);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		await sql`DROP INDEX IF EXISTS events_logical_id_uniq`.execute(db);
	});
}
