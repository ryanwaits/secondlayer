import { getSourceDb } from "@secondlayer/shared/db";
import type { Database, InsertEvent } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { LocalClient } from "@secondlayer/shared/node/local-client";
import type { Kysely } from "kysely";
import {
	clearStagedForks,
	findSettledFork,
	stageForkContender,
} from "./fork-choice.ts";
import {
	parseBlock,
	parseEvent,
	parseTransaction,
	stripNullBytes,
} from "./parser.ts";
import { persistBlock } from "./persist.ts";
import { detectReorg, handleReorg } from "./reorg.ts";
import { validateStreamsEventPayload } from "./streams-payload-schema.ts";
import type {
	NewBlockPayload,
	TransactionPayload,
} from "./types/node-events.ts";

// Opt-in (default off): validate decoded event payloads and dead-letter the
// malformed ones for observability. The event is still persisted regardless, so
// this never drops chain data. Off by default to keep the ingest hot path lean.
const STREAMS_PAYLOAD_VALIDATION_ENABLED =
	process.env.STREAMS_PAYLOAD_VALIDATION === "true";

export async function recordDeadLetterEvents(
	db: Kysely<Database>,
	evts: InsertEvent[],
): Promise<void> {
	const rows = evts
		.map((evt) => {
			const reason = validateStreamsEventPayload(evt.type, evt.data);
			return reason
				? {
						block_height: evt.block_height,
						tx_id: evt.tx_id,
						event_index: evt.event_index,
						event_type: evt.type,
						data: evt.data,
						reason,
					}
				: null;
		})
		.filter((row): row is NonNullable<typeof row> => row !== null);

	if (rows.length === 0) return;

	// Best-effort: a dead-letter write must never fail ingestion.
	try {
		await db.insertInto("dead_letter_events").values(rows).execute();
		logger.warn("Dead-lettered malformed event payloads", {
			count: rows.length,
			blockHeight: evts[0]?.block_height,
		});
	} catch (err) {
		logger.error("Failed to record dead-letter events", { error: err });
	}
}

/**
 * In-process block ingestion — the single path for indexing a block, whether it
 * arrives over HTTP (`POST /new_block` from the node event observer) or from an
 * internal producer (tip-follower, auto-backfill). Internal producers call this
 * directly rather than self-POSTing to localhost, which is wrong behind a load
 * balancer and the reason this was extracted.
 */

// Out-of-order tracking (ephemeral, resets on restart).
let lastSeenHeight = 0;
let blocksReceivedOutOfOrder = 0;
let parentHashMismatches = 0;

export function initIngestState(highestSeenBlock: number): void {
	lastSeenHeight = highestSeenBlock;
}

export function getIngestTelemetry(): {
	lastSeenHeight: number;
	blocksReceivedOutOfOrder: number;
	parentHashMismatches: number;
} {
	return { lastSeenHeight, blocksReceivedOutOfOrder, parentHashMismatches };
}

export type IngestResult = {
	/** `staged` — the block claimed a height we already hold and is parked
	 *  until a later block names one of the two as its parent. */
	status: "ok" | "duplicate" | "staged";
	block_height: number;
	transactions: number;
	events: number;
};

export async function ingestNewBlock(
	payload: NewBlockPayload,
): Promise<IngestResult> {
	const db = getSourceDb();

	logger.info("Received new block", {
		height: payload.block_height,
		hash: payload.block_hash,
	});

	// Does this block settle a fork we parked one height below? A block names
	// exactly one parent, so if it names a contender we staged instead of the
	// block we kept, the chain has ruled — apply that reorg now, then let this
	// block land on top of it.
	const settled = await findSettledFork(
		db,
		payload.block_height,
		payload.parent_block_hash,
	);
	if (settled) {
		logger.warn("Chain settled a staged fork — adopting the contender", {
			height: settled.height,
			winner: settled.blockHash,
			loser: settled.incumbentHash,
			decidedBy: payload.block_hash,
		});
		// Capture the incumbent before the sweep hides it: once the contender
		// overwrites this height the deposed block's payload is unrecoverable (the
		// node never re-sends it), so a chain that settles BACK onto the incumbent's
		// branch could never restore this row. Five fork points sat corrupted for
		// months exactly this way under the pre-staging code. Staging the deposed
		// block as a contender gives the flip-back the same one-block settlement
		// path a normal fork gets.
		const deposed = await new LocalClient().getBlockForReplay(
			db,
			settled.height,
		);
		await handleReorg(settled.height, settled.incumbentHash, settled.blockHash);
		await clearStagedForks(db, settled.height);
		if (deposed && deposed.block_hash === settled.incumbentHash) {
			await stageForkContender(db, {
				height: settled.height,
				blockHash: deposed.block_hash,
				parentHash: deposed.parent_block_hash,
				incumbentHash: settled.blockHash,
				payload: deposed,
			});
		} else {
			logger.warn("Deposed incumbent could not be staged for flip-back", {
				height: settled.height,
				incumbent: settled.incumbentHash,
				reconstructed: deposed?.block_hash ?? null,
			});
		}
		// Replays through this same path, so a fork several blocks deep unwinds
		// one height at a time. Each step is strictly lower, so this terminates.
		await ingestNewBlock(settled.payload as NewBlockPayload);
	}

	const reorgCheck = await detectReorg(
		payload.block_height,
		payload.block_hash,
	);
	if (reorgCheck.isReorg && reorgCheck.oldHash) {
		// A hash mismatch is NOT proof the chain moved — the observer emits
		// competing blocks at the same height as a matter of course. Adopting on
		// sight backed the losing fork twice in one week. Park it; the next block
		// names a parent and settles it.
		await stageForkContender(db, {
			height: payload.block_height,
			blockHash: payload.block_hash,
			parentHash: payload.parent_block_hash,
			incumbentHash: reorgCheck.oldHash,
			payload,
		});
		return {
			status: "staged",
			block_height: payload.block_height,
			transactions: 0,
			events: 0,
		};
	}
	{
		// Duplicate — only skip if already canonical.
		const existing = await db
			.selectFrom("blocks")
			.selectAll()
			.where("height", "=", payload.block_height)
			.where("hash", "=", payload.block_hash)
			.where("canonical", "=", true)
			.limit(1)
			.execute();

		if (existing.length > 0) {
			logger.debug("Duplicate block, skipping", {
				height: payload.block_height,
			});
			return {
				status: "duplicate",
				block_height: payload.block_height,
				transactions: 0,
				events: 0,
			};
		}
	}

	if (lastSeenHeight > 0 && payload.block_height < lastSeenHeight) {
		blocksReceivedOutOfOrder++;
		logger.debug("Block received out of order", {
			height: payload.block_height,
			lastSeen: lastSeenHeight,
			outOfOrderCount: blocksReceivedOutOfOrder,
		});
	}
	if (payload.block_height > lastSeenHeight) {
		lastSeenHeight = payload.block_height;
	}

	// Parent hash validation (observability only).
	if (payload.block_height > 1) {
		const parentRow = await db
			.selectFrom("blocks")
			.select("hash")
			.where("height", "=", payload.block_height - 1)
			.where("canonical", "=", true)
			.limit(1)
			.executeTakeFirst();

		if (!parentRow) {
			logger.warn("Missing parent block", {
				height: payload.block_height,
				parentHeight: payload.block_height - 1,
			});
		} else if (parentRow.hash !== payload.parent_block_hash) {
			// The block is still persisted (availability over strictness), but a
			// mismatch here means the row below is off the chain this block extends —
			// every fork-point corruption to date announced itself in this log line.
			parentHashMismatches++;
			logger.error("Parent hash mismatch — fork-point row likely wrong", {
				height: payload.block_height,
				expectedParent: payload.parent_block_hash,
				storedParent: parentRow.hash,
				repair: `repair-fork-block.ts --height ${payload.block_height - 1}`,
			});
		}
	}

	const block = parseBlock(payload);
	const txResults = await Promise.all(
		payload.transactions.map((tx: TransactionPayload) =>
			parseTransaction(tx, payload.block_height),
		),
	);
	const txs = txResults
		.filter((tx): tx is NonNullable<typeof tx> => tx !== null)
		.map((tx) => stripNullBytes(tx) as typeof tx);

	const evts = payload.events
		.map((evt) => parseEvent(evt, payload.block_height))
		.filter((evt): evt is NonNullable<typeof evt> => evt !== null)
		.map((evt) => stripNullBytes(evt) as typeof evt);

	// Persist block + txs/events atomically. Replace-per-height inside (deletes
	// stale rows at this height before insert) keeps reorged heights free of
	// orphaned duplicates — see persistBlock / #46.
	await persistBlock(db, {
		block,
		txs,
		evts,
		blockHeight: payload.block_height,
	});

	if (STREAMS_PAYLOAD_VALIDATION_ENABLED) {
		await recordDeadLetterEvents(db, evts);
	}

	logger.info("Block indexed successfully", {
		height: payload.block_height,
		transactions: txs.length,
		events: evts.length,
	});

	return {
		status: "ok",
		block_height: payload.block_height,
		transactions: txs.length,
		events: evts.length,
	};
}
