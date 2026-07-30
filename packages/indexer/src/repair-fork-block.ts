#!/usr/bin/env bun
/**
 * Replace a height whose stored block is not on the canonical chain.
 *
 * This repairs the damage from adopting a reorg contender without confirmation
 * (fixed in `fork-choice.ts`, but two heights were already written wrong before
 * that landed: 8,654,079 and 8,663,166). Symptom is a `chain_unlinked` integrity
 * status — every height present, but block H+1's `parent_hash` naming a block we
 * do not hold at H.
 *
 * The ordinary ingest path deliberately CANNOT do this: a block arriving for a
 * height we already hold is now staged pending a descendant, which is exactly
 * the protection we want and exactly what blocks a repair. So this tool proves
 * canonicality out-of-band first, then replaces the row directly.
 *
 * Execution events cannot be re-derived from raw node RPC, so the canonical
 * block is sourced from the Hiro API — the documented role for it here (manual
 * backfill/repair only; the live plane stays Hiro-free).
 *
 * Usage:
 *   bun run packages/indexer/src/repair-fork-block.ts --height 8663166
 *   bun run packages/indexer/src/repair-fork-block.ts --height 8663166 --apply
 *
 * Dry-run by default: prints what it would replace and why.
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

function parseArgs(argv: string[]) {
	let height: number | undefined;
	let apply = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--height") height = Number(argv[++i]);
		else if (argv[i] === "--apply") apply = true;
	}
	if (height === undefined || !Number.isSafeInteger(height)) {
		throw new Error("--height <n> is required");
	}
	return { height, apply };
}

async function main() {
	const { height, apply } = parseArgs(process.argv.slice(2));
	const db = getSourceDb();

	const stored = await db
		.selectFrom("blocks")
		.select(["hash", "canonical"])
		.where("height", "=", height)
		.executeTakeFirst();
	if (!stored) {
		throw new Error(`No block stored at ${height} — this is a gap, not a fork`);
	}

	const hiro = new HiroClient();
	// `shared` and `indexer` each declare the observer payload; they are the
	// same wire shape. bulk-backfill bridges it the same way.
	const canonical = (await hiro.getBlockForIndexer(
		height,
	)) as NewBlockPayload | null;
	if (!canonical) {
		throw new Error(`Canonical block ${height} could not be fetched`);
	}

	console.log(`height           ${height}`);
	console.log(
		`stored           ${stored.hash} (canonical=${stored.canonical})`,
	);
	console.log(`canonical        ${canonical.block_hash}`);
	console.log(`transactions     ${canonical.transactions.length}`);
	console.log(`events           ${canonical.events.length}`);

	if (stored.hash === canonical.block_hash) {
		console.log("\nAlready correct — nothing to repair.");
		await closeDb();
		return;
	}

	// Independent confirmation before destroying anything: the block ABOVE must
	// name the canonical block as its parent. Without this we would only be
	// trading one unverified block for another.
	const child = await db
		.selectFrom("blocks")
		.select(["hash", "parent_hash"])
		.where("height", "=", height + 1)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (!child) {
		throw new Error(
			`No canonical block at ${height + 1} to confirm against — refusing`,
		);
	}
	if (child.parent_hash !== canonical.block_hash) {
		throw new Error(
			`Block ${height + 1} names parent ${child.parent_hash}, not ${canonical.block_hash} — refusing`,
		);
	}
	console.log(`confirmed by     ${height + 1} names it as parent`);

	if (!apply) {
		console.log("\n(dry-run — pass --apply to replace)");
		await closeDb();
		return;
	}

	// Clear the losing block's rows so ingest sees a clean height and takes the
	// normal path rather than staging a contender. Children first: neither FK
	// cascades.
	await db.transaction().execute(async (tx) => {
		// Delete events by their TRANSACTION, not just by block_height: an event
		// row can carry a different block_height than the tx it references (reorg
		// churn does this), and `events_tx_id_fkey` then blocks the tx delete.
		await sql`
			DELETE FROM events
			WHERE block_height = ${height}
				 OR tx_id IN (SELECT tx_id FROM transactions WHERE block_height = ${height})
		`.execute(tx);
		await sql`DELETE FROM transactions WHERE block_height = ${height}`.execute(
			tx,
		);
		await sql`DELETE FROM blocks WHERE height = ${height}`.execute(tx);
	});

	const result = await ingestNewBlock(canonical);
	logger.info("Repaired fork block", { height, result });

	const after = await db
		.selectFrom("blocks")
		.select(["hash", "canonical"])
		.where("height", "=", height)
		.executeTakeFirst();
	const linked = after?.hash === child.parent_hash;
	console.log(
		`\nnow stored       ${after?.hash} (canonical=${after?.canonical})`,
	);
	console.log(`links to ${height + 1}  ${linked ? "yes" : "NO — investigate"}`);
	console.log(
		`\nDecoded rows for this height are NOT rebuilt here — run:\n  bun run packages/indexer/src/rederive-decoded-events.ts --from-height ${height} --to-height ${height} --types <types> --apply`,
	);

	await closeDb();
}

main().catch(async (err) => {
	console.error(
		"repair-fork-block failed:",
		err instanceof Error ? err.message : err,
	);
	await closeDb().catch(() => {});
	process.exit(1);
});
