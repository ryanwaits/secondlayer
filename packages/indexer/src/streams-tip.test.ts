import { describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { getCurrentCanonicalTip } from "./streams-tip.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("getCurrentCanonicalTip", () => {
	test("returns the latest canonical block", async () => {
		const db = getDb();
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);

		await db
			.insertInto("blocks")
			.values([
				{
					height: 1,
					hash: "0x01",
					parent_hash: "0x00",
					burn_block_height: 1001,
					timestamp: 1,
					canonical: true,
				},
				{
					height: 2,
					hash: "0x02",
					parent_hash: "0x01",
					burn_block_height: 1002,
					timestamp: 2,
					canonical: false,
				},
			])
			.execute();

		await expect(getCurrentCanonicalTip(db)).resolves.toEqual({
			block_height: 1,
			index_block_hash: "0x01",
			burn_block_height: 1001,
			ts: new Date(1000),
		});
	});
});
