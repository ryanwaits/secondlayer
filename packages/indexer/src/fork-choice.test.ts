import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import {
	clearStagedForks,
	findSettledFork,
	pruneStagedForks,
	stageForkContender,
} from "./fork-choice.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 990_001;

/**
 * The 2026-07-30 incident, as a test.
 *
 * A competing block arrived at a height we already held. We adopted it, the
 * chain kept the block we discarded, and every subgraph wedged behind the hole
 * that left. The chain always answers this question one block later — these
 * tests pin that we now wait for the answer instead of guessing.
 */
describe.skipIf(!HAS_DB)("fork choice", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM pending_fork_blocks WHERE height BETWEEN ${H - 5} AND ${H + 5}`.execute(
			db,
		);
		// Children first — events reference transactions, transactions reference
		// blocks, and neither FK cascades.
		await sql`DELETE FROM events WHERE block_height BETWEEN ${H - 5} AND ${H + 5}`.execute(
			db,
		);
		await sql`DELETE FROM transactions WHERE block_height BETWEEN ${H - 5} AND ${H + 5}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height BETWEEN ${H - 5} AND ${H + 5}`.execute(
			db,
		);
	});

	async function seedCanonical(height: number, hash: string, parent: string) {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("blocks")
			.values({
				height,
				hash,
				parent_hash: parent,
				burn_block_height: height,
				timestamp: 1,
				canonical: true,
			})
			.execute();
	}

	async function stage(hash: string, parent: string, incumbent: string) {
		if (!db) throw new Error("missing db");
		await stageForkContender(db, {
			height: H,
			blockHash: hash,
			parentHash: parent,
			incumbentHash: incumbent,
			payload: { block_height: H, block_hash: hash },
		});
	}

	test("the contender wins when the next block names it as parent", async () => {
		if (!db) throw new Error("missing db");
		await seedCanonical(H, "0xincumbent", "0xparent");
		await stage("0xcontender", "0xparent", "0xincumbent");

		// Block H+1 arrives naming the contender — the chain has ruled.
		const settled = await findSettledFork(db, H + 1, "0xcontender");

		expect(settled).not.toBeNull();
		expect(settled?.height).toBe(H);
		expect(settled?.blockHash).toBe("0xcontender");
		expect(settled?.incumbentHash).toBe("0xincumbent");
	});

	test("the incumbent stands when the next block names it instead", async () => {
		if (!db) throw new Error("missing db");
		await seedCanonical(H, "0xincumbent", "0xparent");
		await stage("0xcontender", "0xparent", "0xincumbent");

		// This is the production case: the contender we would have adopted on
		// sight is exactly the one the chain discarded.
		expect(await findSettledFork(db, H + 1, "0xincumbent")).toBeNull();

		const stillCanonical = await db
			.selectFrom("blocks")
			.select("hash")
			.where("height", "=", H)
			.where("canonical", "=", true)
			.executeTakeFirst();
		expect(stillCanonical?.hash).toBe("0xincumbent");
	});

	test("nothing settles when no fork was staged", async () => {
		if (!db) throw new Error("missing db");
		await seedCanonical(H, "0xincumbent", "0xparent");
		expect(await findSettledFork(db, H + 1, "0xincumbent")).toBeNull();
	});

	test("a contender already promoted does not re-settle", async () => {
		if (!db) throw new Error("missing db");
		// Canonical is already the contender — applying again would re-run a
		// reorg against ourselves.
		await seedCanonical(H, "0xcontender", "0xparent");
		await stage("0xcontender", "0xparent", "0xincumbent");
		expect(await findSettledFork(db, H + 1, "0xcontender")).toBeNull();
	});

	test("staging the same contender twice does not duplicate it", async () => {
		if (!db) throw new Error("missing db");
		await seedCanonical(H, "0xincumbent", "0xparent");
		await stage("0xcontender", "0xparent", "0xincumbent");
		await stage("0xcontender", "0xparent", "0xincumbent");

		const rows = await db
			.selectFrom("pending_fork_blocks")
			.selectAll()
			.where("height", "=", H)
			.execute();
		expect(rows).toHaveLength(1);
	});

	test("clearing a height drops its contenders", async () => {
		if (!db) throw new Error("missing db");
		await seedCanonical(H, "0xincumbent", "0xparent");
		await stage("0xcontender", "0xparent", "0xincumbent");
		await clearStagedForks(db, H);
		expect(await findSettledFork(db, H + 1, "0xcontender")).toBeNull();
	});

	test("contenders too far below the tip are written off", async () => {
		if (!db) throw new Error("missing db");
		await seedCanonical(H, "0xincumbent", "0xparent");
		await stage("0xcontender", "0xparent", "0xincumbent");

		// No future block can name a fork this far back.
		const removed = await pruneStagedForks(db, H + 500);
		expect(removed).toBeGreaterThanOrEqual(1);
		expect(await findSettledFork(db, H + 1, "0xcontender")).toBeNull();
	});
});
