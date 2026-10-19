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
 * canonicality out-of-band first, then replaces the height directly.
 *
 * The canonical block is sourced from `observer_journal`, which holds every
 * `/new_block` body the node sent since 2026-08-11 — fork contenders included.
 * The canonical block at H is the journal row whose `block_hash` equals block
 * H+1's `parent_hash`; it is parsed and persisted through the same path as
 * `repair-from-journal.ts`, so the rows are node-shaped. No journal row means
 * the height predates the journal (or was never delivered): only an
 * archive/feeder rebuild can fix it, and this tool exits non-zero without
 * writing anything.
 *
 * Usage:
 *   bun run packages/indexer/src/repair-fork-block.ts --height 8663166
 *   bun run packages/indexer/src/repair-fork-block.ts --height 8663166 --apply
 *
 * Dry-run by default: prints what it would replace and why.
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import { persistJournalPayload } from "./repair-from-journal.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

export type ForkRepairPlan = {
	height: number;
	stored: { hash: string; canonical: boolean };
	/** The hash block H+1 names as its parent — the canonical block at H. */
	canonicalHash: string;
	payload: NewBlockPayload;
	alreadyCorrect: boolean;
};

/** Resolve the canonical block for `height` from the journal, confirmed by the
 *  canonical child at H+1. Read-only. Throws (never guesses) when the height is
 *  a gap, has no canonical child, or the journal never captured the block. */
export async function planForkRepair(
	db: Kysely<Database>,
	height: number,
): Promise<ForkRepairPlan> {
	const stored = await db
		.selectFrom("blocks")
		.select(["hash", "canonical"])
		.where("height", "=", height)
		.executeTakeFirst();
	if (!stored) {
		throw new Error(`No block stored at ${height} — this is a gap, not a fork`);
	}

	const child = await db
		.selectFrom("blocks")
		.select(["parent_hash"])
		.where("height", "=", height + 1)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (!child) {
		throw new Error(
			`No canonical block at ${height + 1} to confirm against — refusing`,
		);
	}

	const row = await db
		.selectFrom("observer_journal")
		.select(["raw_body"])
		.where("path", "=", "/new_block")
		.where("block_hash", "=", child.parent_hash)
		.orderBy("sequence", "desc")
		.limit(1)
		.executeTakeFirst();
	if (!row) {
		throw new Error(
			`No journal payload for block ${child.parent_hash} at ${height} (named by ${height + 1}) — only an archive/feeder rebuild can fix this height`,
		);
	}
	const payload = JSON.parse(row.raw_body.toString("utf8")) as NewBlockPayload;
	if (payload.block_height !== height) {
		throw new Error(
			`Journal block ${child.parent_hash} is at height ${payload.block_height}, not ${height} — refusing`,
		);
	}

	return {
		height,
		stored,
		canonicalHash: child.parent_hash,
		payload,
		alreadyCorrect: stored.hash === child.parent_hash,
	};
}

/** Replace the height with the journaled canonical block. The losing block's
 *  rows are archived as orphans by `persistBlock`, as on a live reorg. */
export async function applyForkRepair(
	db: Kysely<Database>,
	plan: ForkRepairPlan,
): Promise<void> {
	await persistJournalPayload(db, plan.payload, plan.height);
}

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

	const plan = await planForkRepair(db, height);

	console.log(`height           ${height}`);
	console.log(
		`stored           ${plan.stored.hash} (canonical=${plan.stored.canonical})`,
	);
	console.log(`canonical        ${plan.canonicalHash} (journal)`);
	console.log(`confirmed by     ${height + 1} names it as parent`);
	console.log(`transactions     ${plan.payload.transactions.length}`);
	console.log(`events           ${plan.payload.events.length}`);

	if (plan.alreadyCorrect) {
		console.log("\nAlready correct — nothing to repair.");
		await closeDb();
		return;
	}

	if (!apply) {
		console.log("\n(dry-run — pass --apply to replace)");
		await closeDb();
		return;
	}

	// One repair per height at a time. Two concurrent applies interleave their
	// replace transactions and die on the events→transactions FK (seen live
	// 2026-08-11 when a "killed" ssh repair kept running server-side and a
	// retry raced it). Session-scoped: released automatically when this process
	// exits, however it exits.
	const lock = await sql<{ acquired: boolean }>`
		SELECT pg_try_advisory_lock(hashtext('repair-fork-block'), ${height}) AS acquired
	`.execute(db);
	if (!lock.rows[0]?.acquired) {
		throw new Error(
			`another repair-fork-block --apply is already running for ${height} — refusing`,
		);
	}

	await applyForkRepair(db, plan);
	logger.info("Repaired fork block", { height, hash: plan.canonicalHash });

	const after = await db
		.selectFrom("blocks")
		.select(["hash", "canonical"])
		.where("height", "=", height)
		.executeTakeFirst();
	const linked = after?.hash === plan.canonicalHash;
	console.log(
		`\nnow stored       ${after?.hash} (canonical=${after?.canonical})`,
	);
	console.log(`links to ${height + 1}  ${linked ? "yes" : "NO — investigate"}`);
	console.log(
		`\nDecoded rows for this height are NOT rebuilt here — run:\n  bun run packages/indexer/src/rederive-decoded-events.ts --from-height ${height} --to-height ${height} --types <types> --apply`,
	);

	await closeDb();
}

if (import.meta.main) {
	main().catch(async (err) => {
		console.error(
			"repair-fork-block failed:",
			err instanceof Error ? err.message : err,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
