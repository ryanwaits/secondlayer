import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { sql } from "kysely";
import { getDb } from "../index.ts";
import {
	checkChainDataIntegrity,
	computeContiguousTip,
	countMissingBlocks,
	findGaps,
} from "./integrity.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("integrity queries", () => {
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	const db = HAS_DB ? getDb() : (null as any);

	beforeAll(async () => {
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	afterAll(async () => {
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	async function insertBlock(height: number) {
		await db
			.insertInto("blocks")
			.values({
				height,
				hash: `0x${height.toString(16).padStart(64, "0")}`,
				parent_hash: `0x${(height - 1).toString(16).padStart(64, "0")}`,
				burn_block_height: height,
				timestamp: Math.floor(Date.now() / 1000),
				canonical: true,
			})
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			.onConflict((oc: any) => oc.column("height").doNothing())
			.execute();
	}

	test("findGaps detects gaps in block heights", async () => {
		// Insert blocks 1,2,3,7,8,12
		for (const h of [1, 2, 3, 7, 8, 12]) {
			await insertBlock(h);
		}

		const gaps = await findGaps(db);
		expect(gaps).toEqual([
			{ gapStart: 4, gapEnd: 6, size: 3 },
			{ gapStart: 9, gapEnd: 11, size: 3 },
		]);
	});

	test("findGaps respects limit", async () => {
		const gaps = await findGaps(db, 1);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.gapStart).toBe(4);
	});

	test("countMissingBlocks sums gap sizes", async () => {
		const count = await countMissingBlocks(db);
		expect(count).toBe(6);
	});

	test("computeContiguousTip finds contiguous range", async () => {
		// blocks: 1,2,3,7,8,12
		const tip = await computeContiguousTip(db, 1);
		expect(tip).toBe(3);
	});

	test("computeContiguousTip from middle of contiguous range", async () => {
		const tip = await computeContiguousTip(db, 7);
		expect(tip).toBe(8);
	});

	test("computeContiguousTip after filling gap", async () => {
		// Fill gap 4-6
		for (const h of [4, 5, 6]) {
			await insertBlock(h);
		}
		const tip = await computeContiguousTip(db, 1);
		expect(tip).toBe(8);
	});
});

describe.skipIf(!HAS_DB)(
	"checkChainDataIntegrity (wrong/empty volume guard)",
	() => {
		// biome-ignore lint/suspicious/noExplicitAny: test db handle
		const db = HAS_DB ? getDb() : (null as any);
		// Small floor/lookback so the test needs only a couple of rows, not millions.
		// lookback must exceed the function's 1000-wide sample window so the sample
		// sits clearly below the tip (as it does with the real 500k default).
		const opts = { checkFloor: 100, lookback: 5000 };

		beforeEach(async () => {
			await sql`DELETE FROM events`.execute(db);
			await sql`DELETE FROM transactions`.execute(db);
			await sql`DELETE FROM blocks`.execute(db);
		});

		afterAll(async () => {
			await sql`DELETE FROM blocks`.execute(db);
		});

		async function insertBlock(height: number) {
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0x${height.toString(16).padStart(64, "0")}`,
					parent_hash: `0x${(height - 1).toString(16).padStart(64, "0")}`,
					burn_block_height: height,
					timestamp: Math.floor(Date.now() / 1000),
					canonical: true,
				})
				// biome-ignore lint/suspicious/noExplicitAny: kysely onConflict builder
				.onConflict((oc: any) => oc.column("height").doNothing())
				.execute();
		}

		test("ok below the check floor (can't tell fresh install from empty)", async () => {
			await insertBlock(50);
			const r = await checkChainDataIntegrity(db, opts);
			expect(r.ok).toBe(true);
			expect(r.maxHeight).toBe(50);
		});

		test("fails when tip is high but the implied deep history is missing", async () => {
			await insertBlock(20000);
			const r = await checkChainDataIntegrity(db, opts);
			expect(r.ok).toBe(false);
			expect(r.maxHeight).toBe(20000);
			expect(r.sampleHeight).toBe(15000);
			expect(r.reason).toContain("wrong or empty volume");
		});

		test("passes when the implied history is present", async () => {
			await insertBlock(20000);
			await insertBlock(15000);
			const r = await checkChainDataIntegrity(db, opts);
			expect(r.ok).toBe(true);
			expect(r.sampleBlocks).toBeGreaterThan(0);
		});
	},
);
