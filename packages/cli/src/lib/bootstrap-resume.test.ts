import { describe, expect, test } from "bun:test";
import {
	type ArchivePartitionRange,
	type DatasetHighWater,
	partitionIsLoaded,
	planTornImport,
} from "./bootstrap-resume.ts";

const partitions: ArchivePartitionRange[] = [
	{ dataset: "blocks", from_block: 1, to_block: 100 },
	{ dataset: "blocks", from_block: 101, to_block: 200 },
	{ dataset: "transactions", from_block: 1, to_block: 100 },
	{ dataset: "transactions", from_block: 101, to_block: 200 },
	{ dataset: "events", from_block: 1, to_block: 100 },
	{ dataset: "events", from_block: 101, to_block: 200 },
];

const empty: DatasetHighWater = {
	blocks: null,
	transactions: null,
	events: null,
};

/** The remainder bootstrap would load, named by dataset and first height. */
function remaining(highWater: DatasetHighWater): string[] {
	const plan = planTornImport({
		hasIndexProgress: false,
		highWater,
		partitions,
	});
	return partitions
		.filter(
			(p) =>
				plan.action === "fresh" ||
				(plan.action === "resume" && !partitionIsLoaded(p, plan.skipThrough)),
		)
		.map((p) => `${p.dataset}:${p.from_block}`);
}

describe("torn archive import resume", () => {
	test("fresh empty database starts from the first partition", () => {
		expect(
			planTornImport({
				hasIndexProgress: false,
				highWater: empty,
				partitions,
			}),
		).toEqual({ action: "fresh" });
	});

	test("refuses a completed bootstrap", () => {
		const plan = planTornImport({
			hasIndexProgress: true,
			highWater: { blocks: 200, transactions: 200, events: 200 },
			partitions,
		});
		expect(plan.action).toBe("refuse");
	});

	test("resumes after a sealed blocks partition and still loads every child partition", () => {
		const plan = planTornImport({
			hasIndexProgress: false,
			highWater: { ...empty, blocks: 100 },
			partitions,
		});
		expect(plan).toEqual({
			action: "resume",
			truncateFrom: { blocks: null, transactions: null, events: null },
			skipThrough: { blocks: 100, transactions: 0, events: 0 },
		});
		expect(remaining({ ...empty, blocks: 100 })).toEqual([
			"blocks:101",
			"transactions:1",
			"transactions:101",
			"events:1",
			"events:101",
		]);
	});

	test("a crash after the whole blocks pass leaves every transactions and events partition to load", () => {
		// Blocks sit at the archive tip; nothing else has landed. The old
		// blocks-only mark called this complete and refused with no work left.
		expect(remaining({ ...empty, blocks: 200 })).toEqual([
			"transactions:1",
			"transactions:101",
			"events:1",
			"events:101",
		]);
	});

	test("a crash during the events pass reloads only the events partitions still missing", () => {
		expect(remaining({ blocks: 200, transactions: 200, events: 100 })).toEqual([
			"events:101",
		]);
	});

	test("a crash mid-partition truncates that dataset from the torn partition's first height", () => {
		const plan = planTornImport({
			hasIndexProgress: false,
			highWater: { blocks: 200, transactions: 150, events: null },
			partitions,
		});
		expect(plan).toEqual({
			action: "resume",
			truncateFrom: { blocks: null, transactions: 101, events: 101 },
			skipThrough: { blocks: 200, transactions: 100, events: 0 },
		});
	});

	test("a torn blocks partition truncates its transactions and events from the same height", () => {
		// Children can never outlive the block they hang off.
		const plan = planTornImport({
			hasIndexProgress: false,
			highWater: { blocks: 150, transactions: 150, events: 150 },
			partitions,
		});
		expect(plan).toEqual({
			action: "resume",
			truncateFrom: { blocks: 101, transactions: 101, events: 101 },
			skipThrough: { blocks: 100, transactions: 100, events: 100 },
		});
	});

	test("a child dataset never counts as sealed past its parent, and its rows above that boundary are truncated before the reload", () => {
		const plan = planTornImport({
			hasIndexProgress: false,
			highWater: { blocks: 100, transactions: 200, events: 200 },
			partitions,
		});
		expect(plan).toEqual({
			action: "resume",
			truncateFrom: { blocks: null, transactions: 101, events: 101 },
			skipThrough: { blocks: 100, transactions: 100, events: 100 },
		});
	});

	test("every partition loaded leaves nothing to load, and the plan still resumes rather than refusing", () => {
		const plan = planTornImport({
			hasIndexProgress: false,
			highWater: { blocks: 200, transactions: 200, events: 200 },
			partitions,
		});
		expect(plan.action).toBe("resume");
		expect(remaining({ blocks: 200, transactions: 200, events: 200 })).toEqual(
			[],
		);
	});

	test("a dataset the planner does not track is never skipped", () => {
		expect(
			partitionIsLoaded(
				{ dataset: "digest_index", from_block: 1, to_block: 100 },
				{ blocks: 200, transactions: 200, events: 200 },
			),
		).toBe(false);
	});
});
