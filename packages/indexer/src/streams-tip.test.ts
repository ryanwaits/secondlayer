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
			block_hash: "0x01",
			burn_block_height: 1001,
			ts: new Date(1000),
		});
	});
});

describe.skipIf(!HAS_DB)(
	"getCurrentCanonicalTip with a hole in the chain",
	() => {
		test("stops at the last contiguous block, not the highest canonical block", async () => {
			const db = getDb();
			await sql`DELETE FROM events`.execute(db);
			await sql`DELETE FROM transactions`.execute(db);
			await sql`DELETE FROM blocks`.execute(db);
			const network = process.env.STACKS_NETWORK || "mainnet";
			await sql`DELETE FROM index_progress WHERE network = ${network}`.execute(
				db,
			);

			await db
				.insertInto("blocks")
				.values(
					[1, 2, 4].map((height) => ({
						height,
						hash: `0x0${height}`,
						parent_hash: `0x0${height - 1}`,
						burn_block_height: 1000 + height,
						timestamp: height,
						canonical: true,
					})),
				)
				.execute();
			await db
				.insertInto("index_progress")
				.values({
					network,
					last_indexed_block: 4,
					last_contiguous_block: 2,
					highest_seen_block: 4,
				})
				.execute();

			const tip = await getCurrentCanonicalTip(db);
			expect(tip?.block_height).toBe(2);

			await sql`DELETE FROM index_progress WHERE network = ${network}`.execute(
				db,
			);
		});
	},
);
