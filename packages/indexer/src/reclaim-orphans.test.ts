import { beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { reclaimLinkedOrphans } from "./integrity.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const BASE = 970_001;

/**
 * The 2026-07-30 wedge: a reorg sweep marked three blocks non-canonical, the
 * new fork turned out to contain those same blocks, and nothing ever flipped
 * them back. `last_contiguous_block` stopped there and every subgraph stalled
 * behind it for hours.
 */
describe.skipIf(!HAS_DB)("reclaimLinkedOrphans", () => {
	const db = HAS_DB ? getSourceDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM blocks WHERE height BETWEEN ${BASE} AND ${BASE + 10}`.execute(
			db,
		);
	});

	async function seed(
		rows: Array<{
			height: number;
			hash: string;
			parent: string;
			canon: boolean;
		}>,
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
					canonical: r.canon,
				})
				.execute();
		}
	}

	async function canonicalAt(height: number): Promise<boolean> {
		if (!db) throw new Error("missing db");
		const row = await db
			.selectFrom("blocks")
			.select("canonical")
			.where("height", "=", height)
			.executeTakeFirst();
		return row?.canonical === true;
	}

	test("reclaims a run of orphans the canonical chain links back through", async () => {
		await seed([
			{ height: BASE, hash: "0xa", parent: "0x0", canon: true },
			{ height: BASE + 1, hash: "0xb", parent: "0xa", canon: false },
			{ height: BASE + 2, hash: "0xc", parent: "0xb", canon: false },
			{ height: BASE + 3, hash: "0xd", parent: "0xc", canon: true },
		]);

		const reclaimed = await reclaimLinkedOrphans(getSourceDb(), [
			BASE + 1,
			BASE + 2,
		]);

		// Descending order matters: BASE+2 proves itself against the canonical
		// BASE+3, which then lets BASE+1 prove itself against BASE+2.
		expect(reclaimed).toEqual([BASE + 1, BASE + 2]);
		expect(await canonicalAt(BASE + 1)).toBe(true);
		expect(await canonicalAt(BASE + 2)).toBe(true);
	});

	test("leaves a genuinely orphaned block alone", async () => {
		await seed([
			{ height: BASE, hash: "0xa", parent: "0x0", canon: true },
			// The canonical child descends from a DIFFERENT block at this height,
			// so this row really is off-chain and must stay non-canonical.
			{ height: BASE + 1, hash: "0xdead", parent: "0xa", canon: false },
			{ height: BASE + 2, hash: "0xc", parent: "0xlive", canon: true },
		]);

		expect(await reclaimLinkedOrphans(getSourceDb(), [BASE + 1])).toEqual([]);
		expect(await canonicalAt(BASE + 1)).toBe(false);
	});

	test("does nothing when the child is not canonical either", async () => {
		await seed([
			{ height: BASE + 1, hash: "0xb", parent: "0xa", canon: false },
			{ height: BASE + 2, hash: "0xc", parent: "0xb", canon: false },
		]);

		expect(await reclaimLinkedOrphans(getSourceDb(), [BASE + 1])).toEqual([]);
		expect(await canonicalAt(BASE + 1)).toBe(false);
	});
});
