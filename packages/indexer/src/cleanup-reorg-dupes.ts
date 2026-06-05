/**
 * One-time cleanup: remove reorg-orphaned duplicate transactions/events (#46).
 *
 * Before the replace-per-height ingest fix, a reorged height left the orphaned
 * block's rows behind, so some (block_height, tx_index) slots hold >1
 * transaction (different tx_id). Those orphaned rows leak into the Streams
 * query and collide cursors. This keeps the latest transaction per
 * (block_height, tx_index) — the later insert is the new (canonical) chain —
 * and deletes the older ones plus their events.
 *
 * Run against the target DB (prod env / indexer container). Dry-run by default;
 * pass `--apply` to delete. Run AFTER the replace-per-height fix is deployed and
 * BEFORE the L2 backfill.
 *
 *   bun run packages/indexer/src/cleanup-reorg-dupes.ts                 # dry-run
 *   bun run packages/indexer/src/cleanup-reorg-dupes.ts --apply
 *   bun run packages/indexer/src/cleanup-reorg-dupes.ts --from-height 8000000 --apply
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

type Args = { fromHeight?: number; toHeight?: number; apply: boolean };

function parseArgs(argv: string[]): Args {
	let fromHeight: number | undefined;
	let toHeight: number | undefined;
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
		if (v !== undefined && !Number.isSafeInteger(v)) {
			throw new Error(`${name} must be an integer`);
		}
	}
	return { fromHeight, toHeight, apply };
}

// Orphaned tx_ids = every duplicate at a (block_height, tx_index) slot except
// the most-recently-inserted one (the new chain after the reorg).
function orphanedTxIds(args: Args) {
	const bounds = [
		args.fromHeight !== undefined
			? sql`block_height >= ${args.fromHeight}`
			: null,
		args.toHeight !== undefined ? sql`block_height <= ${args.toHeight}` : null,
	].filter((p): p is NonNullable<typeof p> => p !== null);
	const whereClause =
		bounds.length > 0 ? sql`WHERE ${sql.join(bounds, sql` AND `)}` : sql``;
	return sql`
		SELECT tx_id FROM (
			SELECT
				tx_id,
				ROW_NUMBER() OVER (
					PARTITION BY block_height, tx_index
					ORDER BY created_at DESC, tx_id DESC
				) AS rn
			FROM transactions
			${whereClause}
		) ranked
		WHERE ranked.rn > 1
	`;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db: Kysely<Database> = getSourceDb();
	const orphaned = orphanedTxIds(args);

	const scope =
		args.fromHeight !== undefined || args.toHeight !== undefined
			? `heights [${args.fromHeight ?? 0}, ${args.toHeight ?? "tip"}]`
			: "all heights";
	console.log(
		`[cleanup-reorg-dupes] scope: ${scope} · ${args.apply ? "APPLY" : "dry-run"}`,
	);

	const counts = await sql<{ orphan_txs: string; affected_events: string }>`
		SELECT
			(SELECT count(*) FROM (${orphaned}) o) AS orphan_txs,
			(SELECT count(*) FROM events WHERE tx_id IN (${orphaned})) AS affected_events
	`.execute(db);
	const orphanTxs = Number(counts.rows[0]?.orphan_txs ?? 0);
	const affectedEvents = Number(counts.rows[0]?.affected_events ?? 0);
	console.log(
		`  orphaned transactions: ${orphanTxs} · their events: ${affectedEvents}`,
	);

	if (orphanTxs === 0) {
		console.log("[cleanup-reorg-dupes] nothing to clean.");
		await closeDb();
		return;
	}

	if (!args.apply) {
		console.log(
			"[cleanup-reorg-dupes] dry-run only — re-run with --apply to delete.",
		);
		await closeDb();
		return;
	}

	// Delete events first (they reference the orphaned tx_ids), then the txs.
	const delEvents = await sql`
		DELETE FROM events WHERE tx_id IN (${orphaned})
	`.execute(db);
	const delTxs = await sql`
		DELETE FROM transactions WHERE tx_id IN (${orphaned})
	`.execute(db);
	console.log(
		`[cleanup-reorg-dupes] deleted ${Number(delEvents.numAffectedRows ?? 0n)} events, ${Number(delTxs.numAffectedRows ?? 0n)} transactions.`,
	);

	const remaining = await sql<{ n: string }>`
		SELECT count(*) AS n FROM (${orphanedTxIds(args)}) o
	`.execute(db);
	console.log(
		`[cleanup-reorg-dupes] remaining orphaned transactions: ${Number(remaining.rows[0]?.n ?? 0)} (expect 0).`,
	);

	await closeDb();
}

void main();
