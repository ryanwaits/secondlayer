import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { findBrokenLinks } from "@secondlayer/shared/db/queries/integrity";

const HAS_DB = !!process.env.DATABASE_URL;
const BASE = 980_001;

/**
 * The 2026-07-30 incident in miniature: a reorg at height H was resolved the
 * wrong way, so the canonical row at H is a block mainnet orphaned. Every
 * height is present, so `findGaps` reports nothing — but H+1 descends from a
 * block we do not have marked canonical, and the chain does not join up.
 */
describe.skipIf(!HAS_DB)("findBrokenLinks", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM blocks WHERE height BETWEEN ${BASE} AND ${BASE + 10}`.execute(
			db,
		);
	});

	/** The window is relative to MAX(height) across the table, and other suites
	 *  seed rows at unrelated heights — size it from the live max so this test
	 *  does not depend on execution order. */
	async function windowCovering(height: number): Promise<number> {
		if (!db) throw new Error("missing db");
		const row = await db
			.selectFrom("blocks")
			.select(({ fn }) => fn.max("height").as("max_height"))
			.executeTakeFirst();
		return Math.max(100, Number(row?.max_height ?? height) - height + 10);
	}

	async function seed(
		rows: Array<{ height: number; hash: string; parent: string }>,
	) {
		if (!db) throw new Error("missing db");
		for (const r of rows) {
			await db
				.insertInto("blocks")
				.values({
					height: r.height,
					hash: r.hash,
					parent_hash: r.parent,
					burn_block_height: r.height,
					timestamp: 1,
					canonical: true,
				})
				.execute();
		}
	}

	test("catches a canonical height that the next block does not descend from", async () => {
		await seed([
			{ height: BASE, hash: "0xa", parent: "0x0" },
			// The losing fork's block, wrongly adopted as canonical.
			{ height: BASE + 1, hash: "0xlosing", parent: "0xa" },
			// The real chain continued from a different block at BASE+1.
			{ height: BASE + 2, hash: "0xc", parent: "0xwinning" },
		]);

		const broken = await findBrokenLinks(getSourceDb(), {
			window: await windowCovering(BASE),
		});
		const hit = broken.find((b) => b.height === BASE + 2);
		expect(hit).toBeDefined();
		expect(hit?.storedParent).toBe("0xwinning");
		expect(hit?.expectedParent).toBe("0xlosing");
	});

	test("a properly linked chain reports nothing", async () => {
		await seed([
			{ height: BASE, hash: "0xa", parent: "0x0" },
			{ height: BASE + 1, hash: "0xb", parent: "0xa" },
			{ height: BASE + 2, hash: "0xc", parent: "0xb" },
		]);

		const broken = await findBrokenLinks(getSourceDb(), {
			window: await windowCovering(BASE),
		});
		expect(
			broken.filter((b) => b.height >= BASE && b.height <= BASE + 2),
		).toEqual([]);
	});
});
