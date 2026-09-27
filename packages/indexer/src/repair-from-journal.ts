#!/usr/bin/env bun
/**
 * Restore a canonical height's transactions/events from its own observer
 * journal payload — the repair tool for the short blocks a reorg's aftermath
 * can leave behind (a tx a same-height collision moved off a height, or the
 * old doNothing re-mine bug; see the ingest transaction completeness plan).
 *
 * The journal row whose `block_hash` equals the canonical `blocks.hash` at a
 * height is the exact `/new_block` body the node sent for that block — the
 * only source with both the tx set AND the executed events, unlike
 * `transactions_archive` (which holds a *different* block's execution
 * context; see the plan's root-cause notes) or the node (raw txs only, no
 * events or execution results).
 *
 * Dry-run by default: diffs every requested height against its journal
 * payload and prints a table, touching nothing. `--apply` re-persists any
 * height whose tx_id set diverges, through the exact same `persistBlock` path
 * live ingest uses (including its fail-loud completeness assertion).
 * `--verify-node` additionally recomputes the stored txids' tx merkle root
 * and compares it against the node header — see `checkTxMerkleRoot`.
 *
 * Never touches `transactions_archive` / `events_archive`.
 *
 * Usage:
 *   bun run packages/indexer/src/repair-from-journal.ts --heights 8777879,8777880
 *   bun run packages/indexer/src/repair-from-journal.ts --from 8777879 --to 8964808
 *   bun run packages/indexer/src/repair-from-journal.ts --from 8777879 --to 8964808 --apply
 *   bun run packages/indexer/src/repair-from-journal.ts --from 8777879 --to 8964808 --verify-node
 *   bun run packages/indexer/src/repair-from-journal.ts --from 8777879 --to 8964808 --apply --derive
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { fetchNakamotoBlock } from "@secondlayer/shared/node/nakamoto";
import type { Kysely } from "kysely";
import { checkTxMerkleRoot } from "./archive/node-replay-auditor.ts";
import {
	parseBlock,
	parseEvent,
	parseTransaction,
	parseVmEvent,
	stripNullBytes,
} from "./parser.ts";
import { persistBlock } from "./persist.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

export type JournalPayload = { hash: string; payload: NewBlockPayload };

/** The canonical journal payload for a height — the `/new_block` body whose
 *  `block_hash` matches what we currently hold canonical there. `null` if the
 *  height isn't canonical, or no journal row was ever captured for it (e.g.
 *  heights before `observer_journal` existed, 2026-08-11). */
export async function loadCanonicalJournalPayload(
	db: Kysely<Database>,
	height: number,
): Promise<JournalPayload | null> {
	const block = await db
		.selectFrom("blocks")
		.select(["hash"])
		.where("height", "=", height)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (!block) return null;

	const row = await db
		.selectFrom("observer_journal")
		.select(["raw_body"])
		.where("path", "=", "/new_block")
		.where("block_hash", "=", block.hash)
		.orderBy("sequence", "desc")
		.limit(1)
		.executeTakeFirst();
	if (!row) return null;

	return {
		hash: block.hash,
		payload: JSON.parse(row.raw_body.toString("utf8")) as NewBlockPayload,
	};
}

export type HeightDiffStatus =
	| "match"
	| "diverged"
	| "missing_block"
	| "missing_journal";

export type HeightDiff = {
	height: number;
	status: HeightDiffStatus;
	journalTxCount: number | null;
	dbTxCount: number;
	/** In the journal, absent from `transactions`. */
	missingTxIds: string[];
	/** In `transactions`, absent from the journal — a tx that doesn't belong here. */
	extraTxIds: string[];
};

/** Compare a height's `transactions` against its own canonical journal
 *  payload. Read-only. */
export async function diffHeightAgainstJournal(
	db: Kysely<Database>,
	height: number,
): Promise<HeightDiff> {
	const block = await db
		.selectFrom("blocks")
		.select(["hash"])
		.where("height", "=", height)
		.where("canonical", "=", true)
		.executeTakeFirst();
	const dbRows = await db
		.selectFrom("transactions")
		.select("tx_id")
		.where("block_height", "=", height)
		.execute();
	const dbTxIds = new Set(dbRows.map((r) => r.tx_id));

	if (!block) {
		return {
			height,
			status: "missing_block",
			journalTxCount: null,
			dbTxCount: dbTxIds.size,
			missingTxIds: [],
			extraTxIds: [],
		};
	}

	const journal = await loadCanonicalJournalPayload(db, height);
	if (!journal) {
		return {
			height,
			status: "missing_journal",
			journalTxCount: null,
			dbTxCount: dbTxIds.size,
			missingTxIds: [],
			extraTxIds: [],
		};
	}

	const journalTxIds = new Set(
		journal.payload.transactions
			.map((t) => t.txid)
			.filter((id): id is string => !!id),
	);
	const missingTxIds = [...journalTxIds].filter((id) => !dbTxIds.has(id));
	const extraTxIds = [...dbTxIds].filter((id) => !journalTxIds.has(id));

	return {
		height,
		status:
			missingTxIds.length === 0 && extraTxIds.length === 0
				? "match"
				: "diverged",
		journalTxCount: journalTxIds.size,
		dbTxCount: dbTxIds.size,
		missingTxIds,
		extraTxIds,
	};
}

/** Re-persist a height from its canonical journal payload through the normal
 *  persist path (replace-per-height + the fail-loud completeness assertion).
 *  Throws if the height has no journal payload — never guesses. */
export async function repairHeightFromJournal(
	db: Kysely<Database>,
	height: number,
): Promise<void> {
	const journal = await loadCanonicalJournalPayload(db, height);
	if (!journal) {
		throw new Error(
			`repair-from-journal: no journal payload for canonical height ${height}`,
		);
	}
	const { payload } = journal;

	const block = parseBlock(payload);
	const txResults = await Promise.all(
		payload.transactions.map((t) => parseTransaction(t, height)),
	);
	const txs = txResults
		.filter((t): t is NonNullable<typeof t> => t !== null)
		.map((t) => stripNullBytes(t) as typeof t);
	const evts = payload.events
		.map((e) => parseEvent(e, height))
		.filter((e): e is NonNullable<typeof e> => e !== null)
		.map((e) => stripNullBytes(e) as typeof e);
	const vmEvts = Array.isArray(payload.vm_events)
		? payload.vm_events
				.map((e, i) => parseVmEvent(e, height, i))
				.filter((e): e is NonNullable<typeof e> => e !== null)
				.map((e) => stripNullBytes(e) as typeof e)
		: [];

	await persistBlock(db, { block, txs, evts, vmEvts, blockHeight: height });
}

export type NodeVerifyResult =
	| { status: "match" }
	| { status: "mismatch" }
	| { status: "node-unavailable"; reason: string };

/** Recompute the stored txids' tx merkle root for a height and compare it
 *  against the node's own header. Independent of the journal — this checks
 *  what's in `transactions` right now against consensus, not against our own
 *  recorded callback. */
export async function verifyHeightAgainstNode(
	db: Kysely<Database>,
	height: number,
	nodeUrl: string,
	fetchImpl?: typeof fetch,
): Promise<NodeVerifyResult> {
	const block = await db
		.selectFrom("blocks")
		.select(["index_block_hash"])
		.where("height", "=", height)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (!block?.index_block_hash) {
		return { status: "node-unavailable", reason: "no index_block_hash stored" };
	}
	try {
		const fetched = await fetchNakamotoBlock({
			nodeUrl,
			blockId: block.index_block_hash,
			fetchImpl,
		});
		const dbRows = await db
			.selectFrom("transactions")
			.select(["tx_id", "tx_index", "sender", "type"])
			.where("block_height", "=", height)
			.execute();
		const network = process.env.STACKS_NETWORK ?? "mainnet";
		const check = checkTxMerkleRoot(
			dbRows.map((r) => ({
				tx_id: r.tx_id,
				tx_index: Number(r.tx_index),
				sender: r.sender,
				type: r.type,
			})),
			network,
			fetched.header.txMerkleRoot,
		);
		return { status: check.status === "match" ? "match" : "mismatch" };
	} catch (err) {
		return {
			status: "node-unavailable",
			reason: err instanceof Error ? err.message : String(err),
		};
	}
}

type Args = {
	heights: number[];
	apply: boolean;
	verifyNode: boolean;
	derive: boolean;
	nodeUrl: string;
};

function parseArgs(argv: string[]): Args {
	let heightsArg: string | undefined;
	let from: number | undefined;
	let to: number | undefined;
	let apply = false;
	let verifyNode = false;
	let derive = false;
	let nodeUrl = process.env.STACKS_NODE_RPC_URL ?? "http://localhost:20443";
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--heights") heightsArg = argv[++i];
		else if (arg === "--from") from = Number(argv[++i]);
		else if (arg === "--to") to = Number(argv[++i]);
		else if (arg === "--apply") apply = true;
		else if (arg === "--verify-node") verifyNode = true;
		else if (arg === "--derive") derive = true;
		else if (arg === "--node-url") nodeUrl = argv[++i] ?? nodeUrl;
	}

	let heights: number[];
	if (heightsArg) {
		heights = heightsArg.split(",").map((h) => Number(h.trim()));
	} else if (from !== undefined && to !== undefined) {
		if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) {
			throw new Error("--from must be <= --to");
		}
		heights = Array.from({ length: to - from + 1 }, (_, i) => from + i);
	} else {
		throw new Error(
			"either --heights h1,h2,... or --from N --to M is required",
		);
	}
	if (heights.some((h) => !Number.isSafeInteger(h))) {
		throw new Error("all heights must be safe integers");
	}
	return { heights, apply, verifyNode, derive, nodeUrl };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();

	console.log(
		`[repair-from-journal] ${args.heights.length} height(s) · ${args.apply ? "APPLY" : "dry-run"}${args.verifyNode ? " · verify-node" : ""}`,
	);
	console.log(
		"height".padEnd(12) +
			"status".padEnd(18) +
			"journal_tx".padEnd(12) +
			"db_tx".padEnd(8) +
			"missing".padEnd(10) +
			"extra".padEnd(8) +
			(args.verifyNode ? "node" : ""),
	);

	let repaired = 0;
	let diverged = 0;
	let unrepairable = 0;
	const repairedHeights: number[] = [];

	for (const height of args.heights) {
		const diff = await diffHeightAgainstJournal(db, height);
		let nodeResult: NodeVerifyResult | null = null;

		if (diff.status === "diverged") {
			diverged += 1;
			if (args.apply) {
				await repairHeightFromJournal(db, height);
				repaired += 1;
				repairedHeights.push(height);
			}
		} else if (
			diff.status === "missing_block" ||
			diff.status === "missing_journal"
		) {
			unrepairable += 1;
		}

		if (args.verifyNode) {
			nodeResult = await verifyHeightAgainstNode(db, height, args.nodeUrl);
		}

		console.log(
			String(height).padEnd(12) +
				diff.status.padEnd(18) +
				String(diff.journalTxCount ?? "-").padEnd(12) +
				String(diff.dbTxCount).padEnd(8) +
				String(diff.missingTxIds.length).padEnd(10) +
				String(diff.extraTxIds.length).padEnd(8) +
				(nodeResult
					? nodeResult.status === "node-unavailable"
						? `node-unavailable (${nodeResult.reason})`
						: nodeResult.status
					: ""),
		);
	}

	console.log(
		`\n[repair-from-journal] checked ${args.heights.length} · diverged ${diverged} · ${args.apply ? `repaired ${repaired}` : "dry-run (nothing written)"} · unrepairable (no block/journal) ${unrepairable}`,
	);

	if (args.derive && repairedHeights.length > 0) {
		const from = Math.min(...repairedHeights);
		const to = Math.max(...repairedHeights);
		const { rows: typeRows } = await sql<{ type: string }>`
			SELECT DISTINCT type FROM events
			WHERE block_height >= ${from} AND block_height <= ${to}
			ORDER BY type
		`.execute(db);
		const types = typeRows.map((r) => r.type).join(",");
		console.log(
			`\nRe-derive commands for the repaired window [${from}, ${to}] — run AFTER this repair, never before (see the plan's warning about rows the source lacks):`,
		);
		console.log(
			`  bun run packages/indexer/src/rederive-decoded-events.ts --from-height ${from} --to-height ${to} --types ${types} --apply`,
		);
		console.log(
			`  bun run packages/indexer/src/decode/backfill-from-firehose.ts --target sbtc_token --from-height ${from} --to-height ${to} --apply`,
		);
		console.log(
			`  bun run packages/indexer/src/decode/rederive-pox5-events.ts --from-height ${from} --to-height ${to} --apply`,
		);
		console.log(
			`  bun run packages/indexer/src/decode/rederive-bns-events.ts --from-height ${from} --to-height ${to} --apply`,
		);
		console.log(
			`  bun run packages/indexer/src/contracts/rederive-registry.ts --from-height ${from} --to-height ${to} --apply`,
		);
	}

	logger.info("repair_from_journal.done", {
		checked: args.heights.length,
		diverged,
		repaired,
		unrepairable,
		apply: args.apply,
	});

	await closeDb();
}

if (import.meta.main) {
	main().catch(async (err) => {
		console.error(
			"repair-from-journal failed:",
			err instanceof Error ? (err.stack ?? err.message) : err,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
