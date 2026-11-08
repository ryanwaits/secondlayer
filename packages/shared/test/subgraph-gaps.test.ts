import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "../src/db/index.ts";
import {
	countSubgraphMissingBlocks,
	findSubgraphGaps,
	recordGapBatch,
	resolveGaps,
} from "../src/db/queries/subgraph-gaps.ts";
import { registerSubgraph } from "../src/db/queries/subgraphs.ts";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("subgraph gaps", () => {
	let id = "";
	const name = "gaps-test-subgraph";

	beforeEach(async () => {
		const sg = await registerSubgraph(getDb(), {
			name,
			version: "1.0.0",
			definition: { name, sources: [{ contract: "SP::c" }], schema: {} },
			schemaHash: "gaps-hash",
			handlerPath: "/tmp/gaps.ts",
		});
		id = sg.id;
	});

	afterEach(async () => {
		await getDb().deleteFrom("subgraphs").execute();
	});

	async function open(subgraphId = id) {
		const { gaps } = await findSubgraphGaps(getDb(), subgraphId, {
			limit: 100,
		});
		return gaps.map((g) => [g.gapStart, g.gapEnd]);
	}

	test("a backwards range is refused", async () => {
		await expect(
			recordGapBatch(getDb(), id, name, [
				{ start: 20, end: 10, reason: "processing_error" },
			]),
		).rejects.toThrow(/start is after end/);
	});

	test("the table itself refuses a backwards range", async () => {
		await expect(
			getDb()
				.insertInto("subgraph_gaps")
				.values({
					subgraph_id: id,
					subgraph_name: name,
					gap_start: 20,
					gap_end: 10,
					reason: "processing_error",
				})
				.execute(),
		).rejects.toThrow(/subgraph_gaps_range_check/);
	});

	test("overlapping ranges record only the blocks no gap covers yet", async () => {
		const db = getDb();
		await recordGapBatch(db, id, name, [
			{ start: 10, end: 20, reason: "processing_error" },
		]);
		await recordGapBatch(db, id, name, [
			{ start: 15, end: 30, reason: "block_missing" },
		]);

		expect(await open()).toEqual([
			[10, 20],
			[21, 30],
		]);
		// 21 blocks, not the 27 a double count of 15-20 would give.
		expect(await countSubgraphMissingBlocks(db, id)).toBe(21);
	});

	test("overlaps inside one batch are not recorded twice", async () => {
		await recordGapBatch(getDb(), id, name, [
			{ start: 1, end: 10, reason: "processing_error" },
			{ start: 5, end: 12, reason: "processing_error" },
		]);

		expect(await open()).toEqual([
			[1, 10],
			[11, 12],
		]);
	});

	test("a range that only partly overlaps a gap repairs exactly that part", async () => {
		const db = getDb();
		await recordGapBatch(db, id, name, [
			{ start: 10, end: 20, reason: "processing_error" },
		]);

		await resolveGaps(db, id, 15, 30);

		expect(await open()).toEqual([[10, 14]]);
		expect(await countSubgraphMissingBlocks(db, id)).toBe(5);
	});

	test("a range inside a gap splits it around the repaired blocks", async () => {
		const db = getDb();
		await recordGapBatch(db, id, name, [
			{ start: 10, end: 20, reason: "processing_error" },
		]);

		await resolveGaps(db, id, 13, 16);

		expect(await open()).toEqual([
			[10, 12],
			[17, 20],
		]);
	});

	test("a gap inside the range resolves whole", async () => {
		const db = getDb();
		await recordGapBatch(db, id, name, [
			{ start: 10, end: 20, reason: "processing_error" },
		]);

		expect(await resolveGaps(db, id, 0, 100)).toBe(1);
		expect(await open()).toEqual([]);
	});

	test("gaps are read and resolved only through the id they were recorded for", async () => {
		const db = getDb();
		const other = await registerSubgraph(db, {
			name: `${name}-other`,
			version: "1.0.0",
			definition: { name: `${name}-other`, sources: [], schema: {} },
			schemaHash: "gaps-hash",
			handlerPath: "/tmp/gaps-other.ts",
		});
		await recordGapBatch(db, id, name, [
			{ start: 10, end: 20, reason: "processing_error" },
		]);

		expect(await open(id)).toEqual([[10, 20]]);
		expect(await open(other.id)).toEqual([]);
		expect(await countSubgraphMissingBlocks(db, other.id)).toBe(0);
		expect(await resolveGaps(db, other.id, 0, 100)).toBe(0);
		expect(await open(id)).toEqual([[10, 20]]);
		expect(await resolveGaps(db, id, 0, 100)).toBe(1);
	});
});
