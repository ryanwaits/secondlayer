import { STREAMS_DB_EVENT_TYPES, sql } from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { insertChainReorg } from "@secondlayer/shared/db/queries/chain-reorgs";
import { markContractsNonCanonical } from "@secondlayer/shared/db/queries/contracts";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely, Transaction } from "kysely";
import { handleBnsReorg } from "./decode/bns-storage.ts";
import { handlePox4Reorg } from "./decode/pox4-storage.ts";
import { handlePox5Reorg } from "./decode/pox5-storage.ts";
import { handleSbtcReorg } from "./decode/sbtc-storage.ts";
import { handleDecodedEventsReorg } from "./decode/storage.ts";
import {
	parseBlock,
	parseEvent,
	parseStateWrites,
	parseTransaction,
	parseVmEvent,
	stripNullBytes,
} from "./parser.ts";
import { persistBlock } from "./persist.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

export async function handleReorg(
	blockHeight: number,
	oldHash: string,
	newHash: string,
): Promise<void> {
	const db = getSourceDb();

	logger.warn("Handling chain reorganization", {
		blockHeight,
		oldHash,
		newHash,
	});

	// Stacks chain reorgs frequently span multiple blocks (microblock reorg
	// followed by an anchor block reorg). When we detect a hash mismatch at
	// `blockHeight` we don't yet know how deep the fork goes — the new
	// chain's parent_hash trail might diverge for many blocks.
	//
	// Conservative approach: mark every block at `blockHeight` AND ABOVE as
	// non-canonical, then let the indexer's normal flow re-establish
	// canonical rows as new-chain blocks arrive. Without the `>=` sweep,
	// stale rows at heights above `blockHeight` would remain `canonical=
	// true` and corrupt subgraph state. The downstream subgraph reorg
	// handler likewise deletes rows `_block_height >= blockHeight`.
	await db.transaction().execute(async (tx: Transaction<Database>) => {
		const affectedTip = await sql<{
			max_height: string | number | null;
		}>`
			SELECT MAX(height) AS max_height
			FROM blocks
			WHERE height >= ${blockHeight}
				AND canonical = true
		`.execute(tx);
		const orphanedToHeight = Number(
			affectedTip.rows[0]?.max_height ?? blockHeight,
		);
		const eventTypeList = sql.join(
			STREAMS_DB_EVENT_TYPES.map((eventType) => sql`${eventType}`),
		);
		const eventCount = await sql<{ count: string | number }>`
			SELECT COUNT(*)::integer AS count
			FROM events
			WHERE block_height = ${orphanedToHeight}
				AND type IN (${eventTypeList})
		`.execute(tx);
		const orphanedToEventIndex = Math.max(
			0,
			Number(eventCount.rows[0]?.count ?? 0) - 1,
		);

		await tx
			.updateTable("blocks")
			.set({ canonical: false })
			.where("height", ">=", blockHeight)
			.where("canonical", "=", true)
			.execute();

		await sql`SELECT pg_notify('subgraph_reorg', ${JSON.stringify({ blockHeight, oldHash, newHash })})`.execute(
			tx,
		);

		// Contracts registry: same `>=` sweep as blocks. Recovery is eventual —
		// discoverDeploys re-selects non-canonical ids whose deploy tx exists on
		// the new fork and recordContractDeploy re-canonicalizes them (CANON-01).
		await markContractsNonCanonical(tx, blockHeight);

		// Reconcile every decoded plane in the same tx: the generic decoded_events
		// table plus the per-asset projections (sBTC, pox4, BNS), which share the
		// same dense-cursor reorg hazard and were previously left un-reconciled
		// (their handlers existed but were never called). Each hard-DELETEs >= H
		// and rewinds its decoder checkpoint. Safe when a plane is disabled/empty
		// (deletes 0 rows). See decoded-events-reorg-reconciliation audit.
		const decodedReorg = await handleDecodedEventsReorg(blockHeight, {
			db: tx,
		});
		const sbtcReorg = await handleSbtcReorg(blockHeight, { db: tx });
		const pox4Reorg = await handlePox4Reorg(blockHeight, { db: tx });
		const pox5Reorg = await handlePox5Reorg(blockHeight, { db: tx });
		const bnsReorg = await handleBnsReorg(blockHeight, { db: tx });
		const reorg = await insertChainReorg({
			db: tx,
			forkPointHeight: blockHeight,
			oldIndexBlockHash: oldHash,
			newIndexBlockHash: newHash,
			orphanedFrom: { block_height: blockHeight, event_index: 0 },
			orphanedTo: {
				block_height: orphanedToHeight,
				event_index: orphanedToEventIndex,
			},
			newCanonicalTip: { block_height: blockHeight, event_index: 0 },
		});

		logger.info("Reorganization handled", {
			blockHeight,
			decodedReorg,
			sbtcReorg,
			pox4Reorg,
			pox5Reorg,
			bnsReorg,
			reorg,
		});
	});
}

// Deepest reorg on record is 91 blocks (2026-08-24). A tx can only be
// re-mined onto a height ABOVE where it truly belongs (a mempool tx is
// unconfirmed at the fork point, so each branch can only include it going
// forward from there) — but the hash-mismatch that triggers a reconcile call
// is detected at whatever height happens to resettle first, which can be
// below the tx's true home if the reorg resolves one height at a time as
// blocks trickle in. Looking back well past the worst known depth keeps a
// stolen tx inside the window regardless of which end of the reorg settles
// first.
export const RECONCILE_LOOKBACK_HEIGHTS = 200;

export type ReorgReconcileResult = { checked: number; repaired: number };

/**
 * Self-heal a reorg's aftermath: for every canonical height in
 * [fromHeight, toHeight], compare its tx_id set against the observer-journal
 * payload for ITS OWN canonical hash, and re-persist from the journal on any
 * mismatch.
 *
 * A hash-mismatch check alone only ever looks at the height where two blocks
 * disagree. It cannot see a tx quietly moved off (or deleted from) a height
 * that never itself changed hash — which is exactly what a same-height
 * tx_id collision at a fresh height, or the old doNothing re-mine bug, did.
 * The journal row whose `block_hash` equals the canonical `blocks.hash` at a
 * height is the ground truth: the exact `/new_block` body the node sent for
 * that block. Replaying it through the normal persist path (with the
 * fail-loud assertion) restores every tx.
 *
 * Fails loudly — throws, no partial reconcile — if a canonical height in
 * range has no matching journal payload. Never silently skip a height this
 * can't verify.
 */
export async function reconcileReorgedRange(
	db: Kysely<Database>,
	fromHeight: number,
	toHeight: number,
): Promise<ReorgReconcileResult> {
	let checked = 0;
	let repaired = 0;
	if (toHeight < fromHeight) {
		return { checked, repaired };
	}

	const canonicalBlocks = await db
		.selectFrom("blocks")
		.select(["height", "hash"])
		.where("height", ">=", fromHeight)
		.where("height", "<=", toHeight)
		.where("canonical", "=", true)
		.orderBy("height", "asc")
		.execute();

	for (const block of canonicalBlocks) {
		checked += 1;
		const height = Number(block.height);

		const journalRow = await db
			.selectFrom("observer_journal")
			.select(["raw_body"])
			.where("path", "=", "/new_block")
			.where("block_hash", "=", block.hash)
			.orderBy("sequence", "desc")
			.limit(1)
			.executeTakeFirst();

		if (!journalRow) {
			throw new Error(
				`reorg_reconcile: no observer_journal payload for canonical height ${height} (hash ${block.hash}) — cannot verify completeness`,
			);
		}

		const nodePayload = JSON.parse(
			journalRow.raw_body.toString("utf8"),
		) as NewBlockPayload;

		const journalTxIds = new Set(
			nodePayload.transactions
				.map((t) => t.txid)
				.filter((id): id is string => !!id),
		);
		const dbRows = await db
			.selectFrom("transactions")
			.select("tx_id")
			.where("block_height", "=", height)
			.execute();
		const dbTxIds = new Set(dbRows.map((r) => r.tx_id));

		const mismatched =
			journalTxIds.size !== dbTxIds.size ||
			[...journalTxIds].some((id) => !dbTxIds.has(id));
		if (!mismatched) continue;

		logger.warn(
			"reorg_reconcile: height diverged from its own canonical journal payload, re-persisting",
			{
				height,
				hash: block.hash,
				journalTxCount: journalTxIds.size,
				dbTxCount: dbTxIds.size,
			},
		);

		const blockInsert = parseBlock(nodePayload);
		const txResults = await Promise.all(
			nodePayload.transactions.map((t) => parseTransaction(t, height)),
		);
		const txs = txResults
			.filter((t): t is NonNullable<typeof t> => t !== null)
			.map((t) => stripNullBytes(t) as typeof t);
		const evts = nodePayload.events
			.map((e) => parseEvent(e, height))
			.filter((e): e is NonNullable<typeof e> => e !== null)
			.map((e) => stripNullBytes(e) as typeof e);
		const vmEvts = Array.isArray(nodePayload.vm_events)
			? nodePayload.vm_events
					.map((e, i) => parseVmEvent(e, height, i))
					.filter((e): e is NonNullable<typeof e> => e !== null)
					.map((e) => stripNullBytes(e) as typeof e)
			: [];

		await persistBlock(db, {
			block: blockInsert,
			txs,
			evts,
			vmEvts,
			stateWrites: parseStateWrites(nodePayload.state_writes, height),
			blockHeight: height,
		});
		repaired += 1;
	}

	logger.info("reorg_reconcile", { checked, repaired });
	return { checked, repaired };
}

/**
 * Detects if a new block represents a reorganization
 * Returns true if reorg detected
 */
export async function detectReorg(
	blockHeight: number,
	newHash: string,
): Promise<{ isReorg: boolean; oldHash?: string }> {
	const db = getSourceDb();

	const existingBlock = await db
		.selectFrom("blocks")
		.selectAll()
		.where("height", "=", blockHeight)
		.where("canonical", "=", true)
		.limit(1)
		.executeTakeFirst();

	if (!existingBlock) {
		return { isReorg: false };
	}

	if (existingBlock.hash !== newHash) {
		return {
			isReorg: true,
			oldHash: existingBlock.hash,
		};
	}

	return { isReorg: false };
}
