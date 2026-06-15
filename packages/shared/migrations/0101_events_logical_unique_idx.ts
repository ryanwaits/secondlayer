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
 * duplicates (CREATE UNIQUE INDEX would ABORT the migrate run and the deploy),
 * and an inline blocking build over the full mainnet `events` table (152.9M rows)
 * is unacceptable during migrate regardless — it holds ACCESS EXCLUSIVE and far
 * exceeds the default statement_timeout. So this migration NEVER does heavy work
 * inline: it gates on the INSTANT `pg_class.reltuples` planner estimate (no scan)
 * and skips with a NOTICE on any large table. The migrate step succeeds, the live
 * indexer keeps running (its inserts use a target-less ON CONFLICT DO NOTHING that
 * needs no index), and nothing breaks. Only a small table (dev/test, or an empty
 * fresh DB) gets the index built inline — there a cheap dup-probe runs first.
 *
 * On prod the historical duplicates (blocks 2,021,105–4,327,077, ~8.25M excess)
 * must be removed FIRST via `dedupe-events.ts --apply`, then the index
 * pre-created `CONCURRENTLY` (matching this name exactly). Once it exists this
 * migration no-ops via the index-exists check below on every subsequent deploy.
 * See the runbook `docs/internal/audits/decoded-events-supply-shortfall-2026-06-15.md`.
 *
 * `events` is a chain-plane table → DDL no-ops on the control DB under the split.
 */

// Above this row count, never build the index inline during migrate — skip with a
// NOTICE and let the operator build it CONCURRENTLY (runbook). Below it (dev/test),
// an inline build is fast and a brief lock is acceptable.
const INLINE_BUILD_MAX_ROWS = 1_000_000;

export async function up(db: Kysely<unknown>): Promise<void> {
	await onChainPlane(async () => {
		const skipNotice = (reason: string) =>
			sql`DO $$ BEGIN RAISE NOTICE ${sql.lit(`events_logical_id_uniq SKIPPED: ${reason} — see migration 0101 header / runbook.`)}; END $$`.execute(
				db,
			);

		// (1) Already built (e.g. prod, pre-created CONCURRENTLY post-dedupe) → no-op.
		const existing = await sql<{ one: number }>`
			SELECT 1 AS one FROM pg_indexes WHERE indexname = 'events_logical_id_uniq'
		`.execute(db);
		if (existing.rows.length > 0) return;

		// (2) Cheap planner estimate — no table scan. Skip the inline build on any
		// large table; reltuples is accurate on prod (heavily autovacuumed). A
		// never-analyzed table reports -1 → treated as small (dev/fresh).
		const est = await sql<{ rows: number }>`
			SELECT COALESCE(reltuples, -1)::bigint AS rows
			FROM pg_class WHERE oid = to_regclass('public.events')
		`.execute(db);
		const rowEstimate = Number(est.rows[0]?.rows ?? -1);
		if (rowEstimate > INLINE_BUILD_MAX_ROWS) {
			await skipNotice(
				`events ~${rowEstimate} rows — run dedupe-events.ts then CREATE UNIQUE INDEX CONCURRENTLY`,
			);
			return;
		}

		// (3) Small table: a dup-probe is cheap here, so don't risk an aborting
		// CREATE UNIQUE INDEX if a dev/test fixture seeded duplicate logical keys.
		const probe = await sql<{ has_dupes: boolean }>`
			SELECT EXISTS (
				SELECT 1 FROM events
				GROUP BY block_height, tx_id, event_index HAVING count(*) > 1
			) AS has_dupes
		`.execute(db);
		if (probe.rows[0]?.has_dupes) {
			await skipNotice(
				"duplicate (block_height, tx_id, event_index) rows present",
			);
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
