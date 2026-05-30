import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import {
	parseBlock,
	parseEvent,
	parseTransaction,
	stripNullBytes,
} from "./parser.ts";
import { persistBlock } from "./persist.ts";
import { detectReorg, handleReorg } from "./reorg.ts";
import type {
	NewBlockPayload,
	TransactionPayload,
} from "./types/node-events.ts";

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

export function initIngestState(highestSeenBlock: number): void {
	lastSeenHeight = highestSeenBlock;
}

export function getIngestTelemetry(): {
	lastSeenHeight: number;
	blocksReceivedOutOfOrder: number;
} {
	return { lastSeenHeight, blocksReceivedOutOfOrder };
}

export type IngestResult = {
	status: "ok" | "duplicate";
	block_height: number;
	transactions: number;
	events: number;
};

export async function ingestNewBlock(
	payload: NewBlockPayload,
): Promise<IngestResult> {
	const db = getDb();

	logger.info("Received new block", {
		height: payload.block_height,
		hash: payload.block_hash,
	});

	const reorgCheck = await detectReorg(
		payload.block_height,
		payload.block_hash,
	);
	if (reorgCheck.isReorg && reorgCheck.oldHash) {
		await handleReorg(
			payload.block_height,
			reorgCheck.oldHash,
			payload.block_hash,
		);
	} else {
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
			logger.warn("Parent hash mismatch", {
				height: payload.block_height,
				expectedParent: payload.parent_block_hash,
				storedParent: parentRow.hash,
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
