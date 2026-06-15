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
 * ORDERING — a UNIQUE index cannot be built while the table still holds
 * duplicates, and CREATE UNIQUE INDEX would ABORT the migrate run (and the
 * deploy) if it did. So this migration is DEPLOY-SAFE: it probes for a duplicate
 * logical key first and, if any exist, RAISES A NOTICE and skips — the migrate
 * step still succeeds, the live indexer keeps running (its inserts use a
 * target-less ON CONFLICT DO NOTHING that needs no index), and nothing breaks.
 * On a clean DB (fresh/dev, or prod AFTER the dedupe) it builds the index inline.
 *
 * On prod the historical duplicates (blocks 2,021,105–4,327,077, ~8.25M excess)
 * must be removed FIRST via `dedupe-events.ts --apply`, then the index
 * pre-created `CONCURRENTLY` (matching this name exactly) so this migration —
 * whether it skipped earlier or re-runs — is a lock-free no-op via IF NOT EXISTS.
 * See the runbook `docs/internal/audits/decoded-events-supply-shortfall-2026-06-15.md`.
 * A blocking build over the full mainnet `events` table would also exceed the
 * default statement_timeout, so lift it for this tx (mirrors 0090).
 *
 * `events` is a chain-plane table → DDL no-ops on the control DB under the split.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		// Skip (don't abort) if duplicates remain — see header. EXISTS over a
		// grouped probe short-circuits on the first dup, so it's cheap.
		const probe = await sql<{ has_dupes: boolean }>`
			SELECT EXISTS (
				SELECT 1 FROM events
				GROUP BY block_height, tx_id, event_index
				HAVING count(*) > 1
			) AS has_dupes
		`.execute(db);
		if (probe.rows[0]?.has_dupes) {
			await sql`
				DO $$ BEGIN RAISE NOTICE 'events_logical_id_uniq SKIPPED: duplicate (block_height, tx_id, event_index) rows present — run dedupe-events.ts then create the index CONCURRENTLY (see migration 0101 header).'; END $$
			`.execute(db);
			return;
		}
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
