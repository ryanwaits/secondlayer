import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { recomputeContiguous } from "./integrity.ts";
import { type PersistBlockInput, persistBlock } from "./persist.ts";
import { getCurrentCanonicalTip } from "./streams-tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const NETWORK = process.env.STACKS_NETWORK || "mainnet";

function input(height: number): PersistBlockInput {
	return {
		block: {
			height,
			hash: `0x${height.toString(16).padStart(4, "0")}`,
			parent_hash: `0x${(height - 1).toString(16).padStart(4, "0")}`,
			burn_block_height: 1000 + height,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + height,
			canonical: true,
		},
		txs: [],
		evts: [],
		blockHeight: height,
		network: NETWORK,
	};
}

async function contiguous(): Promise<number> {
	const row = await getDb()
		.selectFrom("index_progress")
		.select("last_contiguous_block")
		.where("network", "=", NETWORK)
		.executeTakeFirst();
	return Number(row?.last_contiguous_block);
}

describe.skipIf(!HAS_DB)("contiguity on a chain whose floor is above 1", () => {
	const clean = async () => {
		const db = getDb();
		await sql`DELETE FROM sync_scopes WHERE network = ${NETWORK}`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
		await sql`DELETE FROM index_progress WHERE network = ${NETWORK}`.execute(
			db,
		);
	};
	beforeEach(clean);
	afterAll(clean);

	test("persisting 66..70 advances contiguous and the raw-plane tip to 70", async () => {
		for (let h = 66; h <= 70; h++) await persistBlock(getDb(), input(h));
		expect(await contiguous()).toBe(70);
		expect((await getCurrentCanonicalTip())?.block_height).toBe(70);
	});

	// A devnet node announces its genesis block at boot, then the observer first
	// sees the chain at the cached height — blocks 1..65 are never delivered.
	test("a lone genesis block does not pin contiguous below a chain that starts at 66", async () => {
		for (const h of [0, 66, 67, 68, 69, 70])
			await persistBlock(getDb(), input(h));
		expect(await contiguous()).toBe(70);
		expect((await getCurrentCanonicalTip())?.block_height).toBe(70);
	});

	test("the integrity recompute keeps the floor above a lone genesis block", async () => {
		for (const h of [0, 66, 67, 68, 69, 70])
			await persistBlock(getDb(), input(h));
		await recomputeContiguous(getDb());
		expect(await contiguous()).toBe(70);
	});

	test("a real hole above a genesis-started floor still caps", async () => {
		for (const h of [0, 66, 67, 69]) await persistBlock(getDb(), input(h));
		await recomputeContiguous(getDb());
		expect(await contiguous()).toBe(67);
		expect((await getCurrentCanonicalTip())?.block_height).toBe(67);
	});

	test("a chain that grows from genesis keeps counting from genesis", async () => {
		for (let h = 0; h <= 4; h++) await persistBlock(getDb(), input(h));
		await recomputeContiguous(getDb());
		expect(await contiguous()).toBe(4);
		await persistBlock(getDb(), input(6));
		await recomputeContiguous(getDb());
		expect(await contiguous()).toBe(4);
	});

	test("a real hole above the floor caps contiguous at the block below it", async () => {
		for (const h of [66, 67, 69]) await persistBlock(getDb(), input(h));
		expect(await contiguous()).toBe(67);
		expect((await getCurrentCanonicalTip())?.block_height).toBe(67);
	});

	test("filling the hole releases the cap", async () => {
		for (const h of [66, 67, 69, 68]) await persistBlock(getDb(), input(h));
		expect(await contiguous()).toBe(69);
	});

	test("the integrity recompute agrees with persist", async () => {
		for (let h = 66; h <= 70; h++) await persistBlock(getDb(), input(h));
		await recomputeContiguous(getDb());
		expect(await contiguous()).toBe(70);
	});

	test("the integrity recompute keeps a real hole capped", async () => {
		for (const h of [66, 67, 69]) await persistBlock(getDb(), input(h));
		await recomputeContiguous(getDb());
		expect(await contiguous()).toBe(67);
	});
});
