import { afterEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import {
	auditCanonicalCoverage,
	computeDesyncFloorHeight,
	summarizeBlockFieldGaps,
	summarizeCanonicalContinuity,
	summarizeRowInvariants,
} from "./canonical-audit.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe("canonical coverage continuity", () => {
	test("includes a missing genesis prefix in the report", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 3,
				toBlock: 8,
				expectedFromBlock: 0,
				gapCount: 1,
				missingBlocks: 2,
				firstGap: { from_block: 7, to_block: 8 },
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toEqual({
			healthy: false,
			complete: false,
			start_mismatch: true,
			prefix_gap: { from_block: 0, to_block: 2 },
			suffix_gap: null,
			suffix_checked: false,
			gap_count: 1,
			missing_blocks: 5,
			first_gap: { from_block: 7, to_block: 8 },
			broken_link_count: 0,
			first_broken_link_height: null,
			duplicate_height_count: 0,
			first_duplicate_height: null,
			short_block_count: 0,
			first_short_block_height: null,
		});
	});

	test("requires both continuity and ancestry", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 42,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 1,
				firstBrokenLinkHeight: 42,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			start_mismatch: false,
			suffix_gap: null,
			suffix_checked: false,
			duplicate_height_count: 0,
			broken_link_count: 1,
			first_broken_link_height: 42,
		});
	});

	test("treats a missing parent height as a gap", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 10,
				expectedFromBlock: 0,
				expectedToBlock: 10,
				gapCount: 1,
				missingBlocks: 1,
				firstGap: { from_block: 7, to_block: 7 },
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			gap_count: 1,
			first_gap: { from_block: 7, to_block: 7 },
		});
	});

	test("labels an unbounded contiguous prefix as incomplete", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 100,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toMatchObject({ healthy: true, complete: false, suffix_checked: false });
	});

	test("reports a checked finalized suffix gap", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 8,
				expectedFromBlock: 0,
				expectedToBlock: 10,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			start_mismatch: false,
			suffix_gap: { from_block: 9, to_block: 10 },
			suffix_checked: true,
			duplicate_height_count: 0,
			missing_blocks: 2,
		});
	});

	test("rejects duplicate canonical heights", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 10,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 1,
				firstDuplicateHeight: 7,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			duplicate_height_count: 1,
			first_duplicate_height: 7,
		});
	});

	test("rejects a short block", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: 0,
				toBlock: 10,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 1,
				firstShortBlockHeight: 7,
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			short_block_count: 1,
			first_short_block_height: 7,
		});
	});

	test("does not accept an empty canonical range", () => {
		expect(
			summarizeCanonicalContinuity({
				fromBlock: null,
				toBlock: null,
				expectedFromBlock: 0,
				gapCount: 0,
				missingBlocks: 0,
				firstGap: null,
				brokenLinkCount: 0,
				firstBrokenLinkHeight: null,
				duplicateHeightCount: 0,
				firstDuplicateHeight: null,
				shortBlockCount: 0,
				firstShortBlockHeight: null,
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			start_mismatch: false,
			prefix_gap: null,
		});
	});
});

describe("tx/event height desync floor arithmetic", () => {
	test("clamps to 0 when the tip sits inside the window", () => {
		expect(computeDesyncFloorHeight(50)).toBe(0);
		expect(computeDesyncFloorHeight(0)).toBe(0);
	});

	test("subtracts the window once the tip exceeds it", () => {
		expect(computeDesyncFloorHeight(300_000)).toBe(100_000);
	});

	test("never goes negative for a custom window larger than the tip", () => {
		expect(computeDesyncFloorHeight(10, 200)).toBe(0);
	});
});

/**
 * The tx/event height-desync invariant behind the crash half of the
 * 2026-08-16 incident (fixed as the reorg-replace delete fix) previously had
 * no standing check anywhere. Seeded at a height past the live table's
 * current max so the bounded desync window always covers it, regardless of
 * how far the rest of the database's canonical chain already extends.
 */
describe.skipIf(!HAS_DB)("tx/event height desync audit", () => {
	const db = HAS_DB ? getSourceDb() : (null as never);
	let base = 0;

	async function currentMaxHeight(): Promise<number> {
		const row = await db
			.selectFrom("blocks")
			.select(({ fn }) => fn.max("height").as("max_height"))
			.executeTakeFirst();
		return Number(row?.max_height ?? 0);
	}

	async function seedBlocks(newBase: number) {
		for (let height = newBase; height <= newBase + 5; height++) {
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0xd${height}`,
					parent_hash: height === newBase ? "0xdparent" : `0xd${height - 1}`,
					burn_block_height: 200_000 + height,
					burn_block_hash: "0xburn",
					timestamp: 1_700_000_000 + height,
					canonical: true,
				})
				.execute();
		}
	}

	afterEach(async () => {
		if (base === 0) return;
		await sql`DELETE FROM events WHERE block_height BETWEEN ${base} AND ${base + 10}`.execute(
			db,
		);
		await sql`DELETE FROM transactions WHERE block_height BETWEEN ${base} AND ${base + 10}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height BETWEEN ${base} AND ${base + 10}`.execute(
			db,
		);
		base = 0;
	});

	test("a seeded desync row is detected", async () => {
		base = (await currentMaxHeight()) + 1000;
		await seedBlocks(base);
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xdesync-tx",
				block_height: base + 2,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP1.c",
				function_name: "f",
				function_args: ["u1"],
				raw_tx: "0x00",
			})
			.execute();
		// The event's block_height disagrees with its own transaction's — the
		// exact invariant break behind the incident's crash half.
		await db
			.insertInto("events")
			.values({
				tx_id: "0xdesync-tx",
				block_height: base + 3,
				event_index: 0,
				type: "contract_event",
				data: { a: 1 },
			})
			.execute();

		const report = await auditCanonicalCoverage({ network: "testnet", db });
		expect(report.tx_event_height_desync.healthy).toBe(false);
		expect(report.tx_event_height_desync.count).toBeGreaterThanOrEqual(1);
	});

	test("a clean range reports healthy", async () => {
		base = (await currentMaxHeight()) + 1000;
		await seedBlocks(base);
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xclean-tx",
				block_height: base + 2,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP1.c",
				function_name: "f",
				function_args: ["u1"],
				raw_tx: "0x00",
			})
			.execute();
		await db
			.insertInto("events")
			.values({
				tx_id: "0xclean-tx",
				block_height: base + 2,
				event_index: 0,
				type: "contract_event",
				data: { a: 1 },
			})
			.execute();

		const report = await auditCanonicalCoverage({ network: "testnet", db });
		expect(report.tx_event_height_desync.healthy).toBe(true);
		expect(report.tx_event_height_desync.count).toBe(0);
	});
});

/**
 * The 2026-09-27 incident: a tx re-mined onto the winning fork at a lower
 * height was skipped at insert, then deleted with its losing-fork height —
 * leaving a canonical block whose `tx_count` disagrees with its actual
 * transaction rows. Nothing gated export on this before. Seeded past the
 * live table's current max, like the desync suite above, so this can run
 * against a real database without touching its existing history.
 */
describe.skipIf(!HAS_DB)("short-block audit", () => {
	const db = HAS_DB ? getSourceDb() : (null as never);
	let base = 0;

	async function currentMaxHeight(): Promise<number> {
		const row = await db
			.selectFrom("blocks")
			.select(({ fn }) => fn.max("height").as("max_height"))
			.executeTakeFirst();
		return Number(row?.max_height ?? 0);
	}

	afterEach(async () => {
		if (base === 0) return;
		await sql`DELETE FROM events WHERE block_height BETWEEN ${base} AND ${base + 5}`.execute(
			db,
		);
		await sql`DELETE FROM transactions WHERE block_height BETWEEN ${base} AND ${base + 5}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height BETWEEN ${base} AND ${base + 5}`.execute(
			db,
		);
		base = 0;
	});

	test("a canonical block short on transactions fails continuity.complete", async () => {
		base = (await currentMaxHeight()) + 1000;
		await db
			.insertInto("blocks")
			.values({
				height: base,
				hash: `0xs${base}`,
				parent_hash: "0xsparent",
				burn_block_height: 200_000 + base,
				burn_block_hash: "0xburn",
				timestamp: 1_700_000_000 + base,
				canonical: true,
				// Two transactions were persisted at insert time, but one was
				// later deleted with the wrong height — the exact shape of the
				// incident this audit exists to catch.
				tx_count: 2,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values({
				tx_id: "0xshort-tx",
				block_height: base,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP1.c",
				function_name: "f",
				function_args: ["u1"],
				raw_tx: "0x00",
			})
			.execute();

		const report = await auditCanonicalCoverage({
			network: "testnet",
			db,
			expectedFromBlock: base,
			expectedToBlock: base,
		});
		expect(report.continuity.short_block_count).toBeGreaterThanOrEqual(1);
		expect(report.continuity.first_short_block_height).toBe(base);
		expect(report.continuity.complete).toBe(false);
	});
});

/**
 * 2026-04→06: blocks 7,440,674–8,199,877 were stored with timestamp 0 and NULL
 * hashes and nothing noticed for 7 months. Seeded past the live max and read
 * with a floor just below the seed, so only these rows are in scope.
 */
describe.skipIf(!HAS_DB)("block field gaps audit", () => {
	const db = HAS_DB ? getSourceDb() : (null as never);
	let base = 0;

	async function seed(empty: {
		timestamp?: boolean;
		burn?: boolean;
		index?: boolean;
	}) {
		const row = await db
			.selectFrom("blocks")
			.select(({ fn }) => fn.max("height").as("max_height"))
			.executeTakeFirst();
		base = Number(row?.max_height ?? 0) + 2000;
		for (let height = base; height <= base + 2; height++) {
			const target = height === base + 1;
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0xf${height}`,
					parent_hash: `0xf${height - 1}`,
					burn_block_height: 300_000 + height,
					burn_block_hash: target && empty.burn ? null : "0xburn",
					index_block_hash: target && empty.index ? null : `0xi${height}`,
					timestamp: target && empty.timestamp ? 0 : 1_700_000_000 + height,
					canonical: true,
				})
				.execute();
		}
	}

	afterEach(async () => {
		if (base === 0) return;
		await sql`DELETE FROM blocks WHERE height BETWEEN ${base} AND ${base + 5}`.execute(
			db,
		);
		base = 0;
	});

	test("a block stored with timestamp 0 is reported with its height", async () => {
		await seed({ timestamp: true });
		const gaps = await summarizeBlockFieldGaps(db, base - 1);
		expect(gaps).toMatchObject({
			healthy: false,
			empty_field_blocks: 1,
			first_empty_field_height: base + 1,
		});
	});

	test("a NULL burn or index hash is reported", async () => {
		await seed({ burn: true, index: true });
		const gaps = await summarizeBlockFieldGaps(db, base - 1);
		expect(gaps.empty_field_blocks).toBe(1);
	});

	test("fully populated blocks report healthy", async () => {
		await seed({});
		const gaps = await summarizeBlockFieldGaps(db, base - 1);
		expect(gaps).toMatchObject({ healthy: true, empty_field_blocks: 0 });
	});
});

/**
 * `burn_block_height` rises with the Stacks height. Seeded past the live max
 * so the regression is the only one this test plants.
 */
describe.skipIf(!HAS_DB)("row invariants audit", () => {
	const db = HAS_DB ? getSourceDb() : (null as never);
	let base = 0;

	afterEach(async () => {
		if (base === 0) return;
		await sql`DELETE FROM blocks WHERE height BETWEEN ${base} AND ${base + 5}`.execute(
			db,
		);
		base = 0;
	});

	test("a block anchored below its parent's burn height is reported", async () => {
		const row = await db
			.selectFrom("blocks")
			.select(({ fn }) => fn.max("height").as("max_height"))
			.executeTakeFirst();
		base = Number(row?.max_height ?? 0) + 3000;
		const burnHeights = [700_000, 700_001, 699_999];
		for (const [i, burn] of burnHeights.entries()) {
			await db
				.insertInto("blocks")
				.values({
					height: base + i,
					hash: `0xr${base + i}`,
					parent_hash: `0xr${base + i - 1}`,
					burn_block_height: burn,
					timestamp: 1_700_000_000 + i,
					canonical: true,
				})
				.execute();
		}

		const invariants = await summarizeRowInvariants(db, base - 1);

		expect(invariants.healthy).toBe(false);
		expect(invariants.burn_height_regression_count).toBeGreaterThanOrEqual(1);
	});
});
