import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { setContiguousIfUnchanged } from "./integrity.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const NETWORK = "integrity-cursor-test";

describe.skipIf(!HAS_DB)("contiguous cursor write", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		await db
			?.deleteFrom("index_progress")
			.where("network", "=", NETWORK)
			.execute();
	}

	async function cursor(): Promise<number> {
		const row = await db
			?.selectFrom("index_progress")
			.select("last_contiguous_block")
			.where("network", "=", NETWORK)
			.executeTakeFirstOrThrow();
		return Number(row?.last_contiguous_block);
	}

	beforeEach(async () => {
		await clean();
		await db
			?.insertInto("index_progress")
			.values({
				network: NETWORK,
				last_indexed_block: 100,
				last_contiguous_block: 100,
				highest_seen_block: 100,
			})
			.execute();
	});
	afterAll(clean);

	test("a recompute computed against an older cursor does not overwrite a newer one", async () => {
		if (!db) return;
		// The scan read 99 and computed 99; persist has since advanced to 100.
		expect(await setContiguousIfUnchanged(db, NETWORK, 99, 99)).toBe(false);
		expect(await cursor()).toBe(100);
	});

	test("a recompute against the current cursor writes its answer", async () => {
		if (!db) return;
		expect(await setContiguousIfUnchanged(db, NETWORK, 100, 90)).toBe(true);
		expect(await cursor()).toBe(90);
	});
});
