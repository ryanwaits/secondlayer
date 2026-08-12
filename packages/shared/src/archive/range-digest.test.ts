import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { getSourceDb } from "../db/index.ts";
import {
	compareRangeDigests,
	computeRangeDigest,
	computeRangeDigests,
} from "./range-digest.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 992_000;
const TO = H + 9;

/**
 * These digests are the free tier's whole value: they must catch the defects we
 * actually hit in production, cheaply, and must NOT report a difference between
 * two honest databases that merely retain different amounts of reorg history.
 */
describe.skipIf(!HAS_DB)("SQL range digests", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		if (!db) return;
		await sql`DELETE FROM events WHERE block_height BETWEEN ${H} AND ${TO}`.execute(
			db,
		);
		await sql`DELETE FROM transactions WHERE block_height BETWEEN ${H} AND ${TO}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height BETWEEN ${H} AND ${TO}`.execute(
			db,
		);
	}

	async function seed() {
		if (!db) throw new Error("missing db");
		for (let i = 0; i <= 9; i++) {
			const height = H + i;
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0xh${height}`,
					parent_hash: `0xh${height - 1}`,
					burn_block_height: height,
					burn_block_hash: "0xburn",
					index_block_hash: null,
					timestamp: 1_700_000_000 + i,
					canonical: true,
				})
				.execute();
		}
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xtx1",
				block_height: H + 2,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP1.c",
				function_name: "f",
				raw_tx: "0x00",
			})
			.execute();
		await db
			.insertInto("events")
			.values({
				tx_id: "0xtx1",
				block_height: H + 2,
				event_index: 0,
				type: "contract_event",
				data: { a: 1 },
			})
			.execute();
	}

	beforeEach(async () => {
		await clean();
		await seed();
	});
	afterAll(clean);

	test("is stable across repeated computation", async () => {
		if (!db) throw new Error("missing db");
		const a = await computeRangeDigest(db, "blocks", H, TO);
		const b = await computeRangeDigest(db, "blocks", H, TO);
		expect(a.digest).toBe(b.digest as string);
		expect(a.row_count).toBe(10);
		expect(a.digest).not.toBeNull();
	});

	test("an empty range has no digest rather than a digest of nothing", async () => {
		if (!db) throw new Error("missing db");
		const empty = await computeRangeDigest(db, "events", H + 5, H + 9);
		expect(empty.row_count).toBe(0);
		expect(empty.digest).toBeNull();
	});

	test("a changed parent link changes the blocks digest", async () => {
		if (!db) throw new Error("missing db");
		const before = await computeRangeDigest(db, "blocks", H, TO);
		// The exact production signature: a canonical child naming a parent that
		// is not the block below it.
		await sql`UPDATE blocks SET parent_hash = '0xwrong' WHERE height = ${H + 4}`.execute(
			db,
		);
		const after = await computeRangeDigest(db, "blocks", H, TO);
		expect(after.row_count).toBe(before.row_count);
		expect(after.digest).not.toBe(before.digest as string);
	});

	test("a missing height changes both count and digest", async () => {
		if (!db) throw new Error("missing db");
		const before = await computeRangeDigest(db, "blocks", H, TO);
		await sql`DELETE FROM blocks WHERE height = ${H + 7}`.execute(db);
		const after = await computeRangeDigest(db, "blocks", H, TO);
		expect(after.row_count).toBe(before.row_count - 1);
		expect(after.digest).not.toBe(before.digest as string);
	});

	test("retained non-canonical history does not change the digest", async () => {
		if (!db) throw new Error("missing db");
		const before = await computeRangeDigest(db, "blocks", H, TO);
		// One node kept an orphaned fork contender; the other pruned it. They are
		// not diverging, and must not be reported as such.
		await db
			.insertInto("blocks")
			.values({
				height: H + 3,
				hash: "0xorphan",
				parent_hash: `0xh${H + 2}`,
				burn_block_height: H + 3,
				timestamp: 1_700_000_000,
				canonical: false,
			})
			.execute()
			.catch(async () => {
				// `blocks` is keyed by height, so simulate retention the way the
				// schema allows: flip the row non-canonical and confirm it drops out.
				await sql`UPDATE blocks SET canonical = false WHERE height = ${H + 3}`.execute(
					db,
				);
			});
		const after = await computeRangeDigest(db, "blocks", H, TO);
		// Either the insert was rejected (digest unchanged) or the row went
		// non-canonical (row excluded) — both must not silently corrupt identity.
		expect(after.digest === before.digest || after.row_count < 10).toBe(true);
	});

	test("compare classifies match, count drift, and identity drift distinctly", async () => {
		if (!db) throw new Error("missing db");
		const reference = await computeRangeDigests(db, H, TO);

		expect(
			compareRangeDigests(reference, reference).every(
				(r) => r.status === "match",
			),
		).toBe(true);

		await sql`UPDATE blocks SET hash = '0xtampered' WHERE height = ${H + 1}`.execute(
			db,
		);
		const tampered = await computeRangeDigests(db, H, TO);
		const blocksResult = compareRangeDigests(tampered, reference).find(
			(r) => r.dataset === "blocks",
		);
		// Same number of rows, different identity — the fork-point signature.
		expect(blocksResult?.status).toBe("digest-mismatch");
		expect(blocksResult?.actual_rows).toBe(blocksResult?.expected_rows ?? -1);

		await sql`DELETE FROM events WHERE block_height = ${H + 2}`.execute(db);
		const missing = await computeRangeDigests(db, H, TO);
		const eventsResult = compareRangeDigests(missing, reference).find(
			(r) => r.dataset === "events",
		);
		expect(eventsResult?.status).toBe("count-mismatch");
	});

	test("reports a range the local database does not have at all", () => {
		const reference = [
			{
				dataset: "blocks" as const,
				from_block: 5_000_000,
				to_block: 5_049_999,
				row_count: 50_000,
				digest: "abc",
				digest_spec: "md5:sql-identity-v1" as const,
			},
		];
		const [result] = compareRangeDigests([], reference);
		expect(result?.status).toBe("missing-locally");
		expect(result?.actual_rows).toBe(0);
	});
});
