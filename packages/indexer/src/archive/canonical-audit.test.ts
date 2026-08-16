import { afterEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import {
	auditCanonicalCoverage,
	computeDesyncFloorHeight,
	summarizeCanonicalContinuity,
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
			}),
		).toMatchObject({
			healthy: false,
			complete: false,
			duplicate_height_count: 1,
			first_duplicate_height: 7,
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
