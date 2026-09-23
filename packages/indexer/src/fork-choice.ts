import { jsonb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";

/**
 * Fork choice: never overwrite a height on the strength of a hash mismatch
 * alone.
 *
 * The node's event observer emits competing blocks at the same height. A
 * mismatch says "someone built a different block here", not "the chain moved" —
 * those are different claims, and only the second justifies orphaning what we
 * already indexed. Treating them as the same picked the losing fork twice in
 * one week (8,654,079 and 8,663,166), the second freezing every subgraph for
 * seventeen hours because the true chain's blocks got swept non-canonical and
 * the node never re-sends what it already sent.
 *
 * The chain resolves this itself, and quickly: the next block names its parent.
 * So a contender is staged rather than applied, and the block after it decides.
 * Cost is one block of latency on a genuine reorg (~5s under Nakamoto) against
 * a wrong adoption that persists until someone notices.
 */

export type StagedFork = {
	height: number;
	blockHash: string;
	parentHash: string;
	incumbentHash: string;
	payload: unknown;
};

/**
 * Hold a block that claims a height we already have. Idempotent — a redelivery
 * of the same contender replaces its payload rather than accumulating rows.
 */
export async function stageForkContender(
	db: Kysely<Database>,
	input: {
		height: number;
		blockHash: string;
		parentHash: string;
		incumbentHash: string;
		payload: unknown;
	},
): Promise<void> {
	await db
		.insertInto("pending_fork_blocks")
		.values({
			height: input.height,
			block_hash: input.blockHash,
			parent_hash: input.parentHash,
			incumbent_hash: input.incumbentHash,
			payload: jsonb(input.payload),
		})
		.onConflict((oc) =>
			oc.columns(["height", "block_hash"]).doUpdateSet({
				payload: jsonb(input.payload),
				parent_hash: input.parentHash,
				incumbent_hash: input.incumbentHash,
			}),
		)
		.execute();

	logger.warn("Fork contender staged, awaiting the next block to decide", {
		height: input.height,
		contender: input.blockHash,
		incumbent: input.incumbentHash,
	});
}

/**
 * Has an incoming block just settled a staged fork one height below it?
 *
 * A block names exactly one parent. If that parent is a contender we staged
 * rather than the block we kept canonical, the chain has chosen — and it chose
 * against us. Returns the staged fork to apply, or null when nothing is
 * pending or the incumbent was right all along.
 */
export async function findSettledFork(
	db: Kysely<Database>,
	childHeight: number,
	childParentHash: string,
): Promise<StagedFork | null> {
	const staged = await db
		.selectFrom("pending_fork_blocks")
		.selectAll()
		.where("height", "=", childHeight - 1)
		.where("block_hash", "=", childParentHash)
		.executeTakeFirst();
	if (!staged) return null;

	// The contender is only interesting if it is not already what we hold.
	const incumbent = await db
		.selectFrom("blocks")
		.select("hash")
		.where("height", "=", childHeight - 1)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (incumbent?.hash === staged.block_hash) return null;

	// A losing branch keeps growing its own blocks, so naming the contender is
	// only a verdict when nothing we hold already extends the incumbent. If a
	// canonical block at the child's height builds on the incumbent, this child
	// is a rival at that height, not proof about the one below: adopting it here
	// put the losing block under a canonical child that never named it.
	if (incumbent) {
		const incumbentChild = await db
			.selectFrom("blocks")
			.select("hash")
			.where("height", "=", childHeight)
			.where("canonical", "=", true)
			.where("parent_hash", "=", incumbent.hash)
			.executeTakeFirst();
		if (incumbentChild) return null;
	}

	return {
		height: Number(staged.height),
		blockHash: staged.block_hash,
		parentHash: staged.parent_hash,
		incumbentHash: staged.incumbent_hash,
		payload: staged.payload,
	};
}

/**
 * Drop the contender that was just adopted: it is the canonical row now.
 * Every other contender at the height stays. Losers are kept indefinitely
 * because the node sends a block's events once; if fork choice ever keeps the
 * wrong block, the staged payload is the only copy of the right one, and
 * deleting it made 17 early heights unrepairable on a collecting node.
 */
export async function clearAdoptedContender(
	db: Kysely<Database>,
	height: number,
	blockHash: string,
): Promise<void> {
	await db
		.deleteFrom("pending_fork_blocks")
		.where("height", "=", height)
		.where("block_hash", "=", blockHash)
		.execute();
}
