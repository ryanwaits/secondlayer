import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	type NodeBlock,
	type StoredBlock,
	applyBlockFieldRepairs,
	isSkip,
	loadBrokenBlocks,
	planBlockFieldRepair,
} from "./repair-block-fields.ts";

const HASH = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;
const INDEX = "ee".repeat(32);
const BURN = `0x${"00".repeat(10)}${"11".repeat(22)}`;

const stored = (over: Partial<StoredBlock> = {}): StoredBlock => ({
	height: 100,
	hash: HASH,
	burn_block_height: 900,
	timestamp: 0,
	burn_block_hash: null,
	index_block_hash: null,
	...over,
});

const node = (over: Partial<NodeBlock> = {}): NodeBlock => ({
	chainLength: 100,
	blockHash: HASH.slice(2),
	indexBlockHash: INDEX,
	consensusHash: "ff".repeat(20),
	timestamp: 1_775_105_245,
	...over,
});

const sortition = { burnBlockHash: BURN, burnBlockHeight: 900 };

describe("planBlockFieldRepair", () => {
	test("fills all three empty fields from the node with 0x-prefixed hashes", () => {
		const plan = planBlockFieldRepair(stored(), node(), sortition);
		expect(plan).toEqual({
			height: 100,
			hash: HASH,
			timestamp: 1_775_105_245,
			burnBlockHash: BURN,
			indexBlockHash: `0x${INDEX}`,
		});
	});

	test("leaves already-populated fields alone", () => {
		const plan = planBlockFieldRepair(
			stored({ timestamp: 1, burn_block_hash: OTHER }),
			node(),
			null,
		);
		expect(plan).toMatchObject({
			timestamp: null,
			burnBlockHash: null,
			indexBlockHash: `0x${INDEX}`,
		});
	});

	test("skips when the node's block does not recompute to the stored hash", () => {
		const plan = planBlockFieldRepair(
			stored(),
			node({ blockHash: OTHER.slice(2) }),
			sortition,
		);
		expect(isSkip(plan)).toBe(true);
	});

	test("skips when the node answers for a different height", () => {
		expect(
			isSkip(
				planBlockFieldRepair(stored(), node({ chainLength: 101 }), sortition),
			),
		).toBe(true);
	});

	test("skips a missing burn hash when the tenure's burn height disagrees", () => {
		const plan = planBlockFieldRepair(stored(), node(), {
			...sortition,
			burnBlockHeight: 901,
		});
		expect(isSkip(plan)).toBe(true);
	});

	test("skips a missing burn hash when the node has no sortition", () => {
		expect(isSkip(planBlockFieldRepair(stored(), node(), null))).toBe(true);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
// Clear of repair-fork-block.test.ts (989321) and reorg.test.ts (990050).
const H = 988_410;

describe.skipIf(!HAS_DB)("applyBlockFieldRepairs", () => {
	const db = HAS_DB ? getDb() : (null as never);

	async function seed(height: number, over: Partial<StoredBlock> = {}) {
		const row = stored({ height, ...over });
		await db
			.insertInto("blocks")
			.values({
				height: row.height,
				hash: row.hash,
				parent_hash: OTHER,
				burn_block_height: row.burn_block_height,
				burn_block_hash: row.burn_block_hash,
				index_block_hash: row.index_block_hash,
				timestamp: row.timestamp,
			})
			.execute();
	}

	beforeEach(async () => {
		await db
			.deleteFrom("blocks")
			.where("height", ">=", H)
			.where("height", "<", H + 10)
			.execute();
	});
	afterAll(async () => {
		await db
			.deleteFrom("blocks")
			.where("height", ">=", H)
			.where("height", "<", H + 10)
			.execute();
	});

	test("fills empty fields and never overwrites populated ones", async () => {
		await seed(H);
		await seed(H + 1, {
			timestamp: 42,
			burn_block_hash: OTHER,
			index_block_hash: OTHER,
		});

		const changed = await applyBlockFieldRepairs(db, [
			{
				height: H,
				hash: HASH,
				timestamp: 7,
				burnBlockHash: BURN,
				indexBlockHash: `0x${INDEX}`,
			},
			{
				height: H + 1,
				hash: HASH,
				timestamp: 7,
				burnBlockHash: BURN,
				indexBlockHash: `0x${INDEX}`,
			},
		]);
		expect(changed).toBe(2);

		const rows = await db
			.selectFrom("blocks")
			.select(["height", "timestamp", "burn_block_hash", "index_block_hash"])
			.where("height", "in", [H, H + 1])
			.orderBy("height")
			.execute();
		expect({ ...rows[0], timestamp: Number(rows[0]?.timestamp) }).toMatchObject(
			{ timestamp: 7, burn_block_hash: BURN, index_block_hash: `0x${INDEX}` },
		);
		expect({ ...rows[1], timestamp: Number(rows[1]?.timestamp) }).toMatchObject(
			{ timestamp: 42, burn_block_hash: OTHER, index_block_hash: OTHER },
		);
		expect(await loadBrokenBlocks(db, H, H + 1)).toHaveLength(0);
	});

	test("does not touch a row whose hash changed since it was checked", async () => {
		await seed(H, { hash: OTHER });
		const changed = await applyBlockFieldRepairs(db, [
			{
				height: H,
				hash: HASH,
				timestamp: 7,
				burnBlockHash: BURN,
				indexBlockHash: `0x${INDEX}`,
			},
		]);
		expect(changed).toBe(0);
		const [row] = await sql<{
			timestamp: string;
		}>`SELECT timestamp FROM blocks WHERE height = ${H}`
			.execute(db)
			.then((r) => r.rows);
		expect(Number(row?.timestamp)).toBe(0);
	});
});
