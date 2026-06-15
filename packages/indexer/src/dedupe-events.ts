/**
 * One-time cleanup: remove whole-block PHYSICAL duplicate `events` rows.
 *
 * Distinct from `cleanup-reorg-dupes.ts`, which dedupes *transactions* by
 * (block_height, tx_index) where the duplicates have DIFFERENT tx_ids (reorg
 * orphans). This script targets the 2026-06 whole-block double-ingestion bug:
 * `events` rows that are identical on the logical key (block_height, tx_id,
 * event_index) — same data, only the uuid `id` PK differs — created when a
 * non-idempotent `bulk-backfill` re-run inserted an already-ingested window with
 * no delete and no unique constraint to conflict on. Observed range on mainnet:
 * blocks 2,021,105–4,327,077 (every event doubled, ~8.25M excess rows). The
 * inflation surfaced as the sBTC supply shortfall (decoded mint−burn 2,331.6 BTC
 * vs on-chain get-total-supply 2,954.7). See
 * `docs/internal/audits/decoded-events-supply-shortfall-2026-06-15.md`.
 *
 * Keeps the lowest `id` per logical key and deletes the rest. Idempotent and
 * safe to re-run. Batches by block-height window so no single statement locks
 * the whole table. Run against the SOURCE/chain plane (getSourceDb).
 *
 * ORDER OF OPERATIONS (prod): run this with --apply FIRST, then create the
 * unique index `events_logical_id_uniq` CONCURRENTLY (migration 0101 / runbook),
 * then re-derive decoded_events for the range and reindex balance subgraphs.
 *
 *   bun run packages/indexer/src/dedupe-events.ts                              # dry-run, default range
 *   bun run packages/indexer/src/dedupe-events.ts --apply
 *   bun run packages/indexer/src/dedupe-events.ts --from-height 2021105 --to-height 4327077 --apply
 *   bun run packages/indexer/src/dedupe-events.ts --from-height 0 --to-height 99999999 --apply   # whole table
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

// Default to the known-affected mainnet window. Override with flags to scope
// elsewhere (e.g. a full-table sweep to prove no other range is duplicated).
const DEFAULT_FROM = 2_021_105;
const DEFAULT_TO = 4_327_077;
const CHUNK = 50_000;

type Args = { fromHeight: number; toHeight: number; apply: boolean };

function parseArgs(argv: string[]): Args {
	let fromHeight = DEFAULT_FROM;
	let toHeight = DEFAULT_TO;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--from-height") fromHeight = Number(argv[++i]);
		else if (arg === "--to-height") toHeight = Number(argv[++i]);
	}
	for (const [name, v] of [
		["--from-height", fromHeight],
		["--to-height", toHeight],
	] as const) {
		if (!Number.isSafeInteger(v)) throw new Error(`${name} must be an integer`);
	}
	if (fromHeight > toHeight)
		throw new Error("--from-height exceeds --to-height");
	return { fromHeight, toHeight, apply };
}

// Count physical excess: rows minus distinct logical keys, in [lo, hi).
async function countExcess(
	db: Kysely<Database>,
	lo: number,
	hi: number,
): Promise<number> {
	const { rows } = await sql<{ excess: string }>`
		SELECT count(*) - count(DISTINCT (block_height, tx_id, event_index)) AS excess
		FROM events
		WHERE block_height >= ${lo} AND block_height < ${hi}
	`.execute(db);
	return Number(rows[0]?.excess ?? 0);
}

// Delete every duplicate but the lowest id per logical key, in [lo, hi).
async function deleteExcess(
	db: Kysely<Database>,
	lo: number,
	hi: number,
): Promise<number> {
	const res = await sql`
		DELETE FROM events
		WHERE id IN (
			SELECT id FROM (
				SELECT id, ROW_NUMBER() OVER (
					PARTITION BY block_height, tx_id, event_index ORDER BY id
				) AS rn
				FROM events
				WHERE block_height >= ${lo} AND block_height < ${hi}
			) ranked
			WHERE ranked.rn > 1
		)
	`.execute(db);
	return Number(res.numAffectedRows ?? 0n);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	console.log(
		`[dedupe-events] scope: heights [${args.fromHeight}, ${args.toHeight}] · ${args.apply ? "APPLY" : "dry-run"}`,
	);

	let totalExcess = 0;
	let totalDeleted = 0;
	for (let lo = args.fromHeight; lo <= args.toHeight; lo += CHUNK) {
		const hi = Math.min(lo + CHUNK, args.toHeight + 1);
		const excess = await countExcess(db, lo, hi);
		if (excess === 0) continue;
		totalExcess += excess;
		if (args.apply) {
			const deleted = await deleteExcess(db, lo, hi);
			totalDeleted += deleted;
			console.log(`  [${lo}, ${hi}) excess=${excess} deleted=${deleted}`);
		} else {
			console.log(`  [${lo}, ${hi}) excess=${excess}`);
		}
	}

	console.log(
		`[dedupe-events] total excess rows: ${totalExcess}${args.apply ? ` · deleted: ${totalDeleted}` : ""}`,
	);
	if (!args.apply) {
		console.log(
			"[dedupe-events] dry-run only — re-run with --apply to delete.",
		);
	} else {
		const residual = await countExcess(db, args.fromHeight, args.toHeight + 1);
		console.log(`[dedupe-events] residual excess: ${residual} (expect 0).`);
	}
	await closeDb();
}

void main();
