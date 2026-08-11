import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { findSettledFork } from "./fork-choice.ts";
import { ingestNewBlock } from "./ingest.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_100;

/**
 * The five-fork-point corruption (Apr–Jul 2026), as a test.
 *
 * The node emits a losing contender at height H, a block briefly extends it,
 * and the chain then abandons that branch and keeps building on the block we
 * originally held. Before deposed incumbents were staged for flip-back, the
 * settle was one-way: the original block's payload was overwritten and could
 * never be restored, leaving the fork-point row on the losing branch while
 * every block above it linked through the winner — a canonical chain with a
 * broken parent link at the fork point, invisible until the archive audit.
 */

function payload(
	height: number,
	hash: string,
	parent: string,
): NewBlockPayload {
	return {
		block_hash: hash,
		block_height: height,
		index_block_hash: hash,
		parent_block_hash: parent,
		parent_index_block_hash: parent,
		burn_block_hash: "0xburn",
		burn_block_height: height,
		miner_txid: "0x00",
		timestamp: 1_700_000_000 + height,
		transactions: [],
		events: [],
	};
}

describe.skipIf(!HAS_DB)("fork flip-back", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function cleanRange() {
		if (!db) return;
		await sql`DELETE FROM pending_fork_blocks WHERE height BETWEEN ${H - 1} AND ${H + 3}`.execute(
			db,
		);
		await sql`DELETE FROM chain_reorgs WHERE fork_point_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
			db,
		);
		await sql`DELETE FROM events WHERE block_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
			db,
		);
		await sql`DELETE FROM transactions WHERE block_height BETWEEN ${H - 1} AND ${H + 3}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height BETWEEN ${H - 1} AND ${H + 3}`.execute(
			db,
		);
	}

	beforeEach(cleanRange);
	// This file's blocks sit above the other reorg suites' heights; a canonical
	// row left here would skew their MAX(height)-based orphaned-range assertions.
	afterAll(cleanRange);

	async function canonicalRow(height: number) {
		if (!db) throw new Error("missing db");
		return db
			.selectFrom("blocks")
			.select(["hash", "parent_hash"])
			.where("height", "=", height)
			.where("canonical", "=", true)
			.executeTakeFirst();
	}

	test("settling a fork stages the deposed incumbent as a contender", async () => {
		if (!db) throw new Error("missing db");
		await ingestNewBlock(payload(H - 1, "0xbase", "0xancestor"));
		await ingestNewBlock(payload(H, "0xoriginal", "0xbase"));
		await ingestNewBlock(payload(H, "0xcontender", "0xbase")); // staged
		await ingestNewBlock(payload(H + 1, "0xchild-of-contender", "0xcontender")); // settles

		expect((await canonicalRow(H))?.hash).toBe("0xcontender");
		// The block we just deposed must be recoverable if the chain flips back.
		const flipBack = await findSettledFork(db, H + 1, "0xoriginal");
		expect(flipBack).not.toBeNull();
		expect(flipBack?.blockHash).toBe("0xoriginal");
		expect(flipBack?.incumbentHash).toBe("0xcontender");
	});

	test("a settle-then-abandon fork restores the fork point instead of leaving a broken link", async () => {
		if (!db) throw new Error("missing db");
		await ingestNewBlock(payload(H - 1, "0xbase", "0xancestor"));
		// The chain we originally held.
		await ingestNewBlock(payload(H, "0xoriginal", "0xbase"));
		// A losing contender arrives and a block briefly extends it — we adopt it.
		await ingestNewBlock(payload(H, "0xcontender", "0xbase"));
		await ingestNewBlock(payload(H + 1, "0xchild-of-contender", "0xcontender"));
		// The network abandons the contender's branch and keeps building on the
		// original: first its child (staged against ours), then the block that
		// settles the battle for good.
		await ingestNewBlock(payload(H + 1, "0xchild-of-original", "0xoriginal"));
		await ingestNewBlock(payload(H + 2, "0xgrandchild", "0xchild-of-original"));

		// The recursion must have cascaded the flip all the way down: the fork
		// point is back on the original block, and every parent link holds.
		expect((await canonicalRow(H))?.hash).toBe("0xoriginal");
		expect((await canonicalRow(H + 1))?.hash).toBe("0xchild-of-original");
		expect((await canonicalRow(H + 1))?.parent_hash).toBe("0xoriginal");
		expect((await canonicalRow(H + 2))?.parent_hash).toBe(
			"0xchild-of-original",
		);

		// This is the exact shape the five corrupted fork points were left in:
		// a canonical child whose parent link names a block we no longer hold.
		const { rows: brokenLinks } = await sql<{ height: number }>`
			SELECT b.height
			  FROM blocks AS b
			  JOIN blocks AS p ON p.height = b.height - 1 AND p.canonical = true
			 WHERE b.height BETWEEN ${H} AND ${H + 2}
			   AND b.canonical = true
			   AND b.parent_hash <> p.hash
		`.execute(db);
		expect(brokenLinks).toHaveLength(0);

		// Both directions of the battle are in the ledger.
		const reorgs = await db
			.selectFrom("chain_reorgs")
			.select(["old_index_block_hash", "new_index_block_hash"])
			.where("fork_point_height", "=", H)
			.orderBy("created_at", "asc")
			.execute();
		expect(
			reorgs.map((r) => [r.old_index_block_hash, r.new_index_block_hash]),
		).toEqual([
			["0xoriginal", "0xcontender"],
			["0xcontender", "0xoriginal"],
		]);
	});
});
