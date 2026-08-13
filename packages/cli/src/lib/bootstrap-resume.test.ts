import { describe, expect, test } from "bun:test";
import { partitionIsLoaded, planTornImport } from "./bootstrap-resume.ts";

const partitions = [
	{ dataset: "blocks", from_block: 1, to_block: 100 },
	{ dataset: "blocks", from_block: 101, to_block: 200 },
	{ dataset: "transactions", from_block: 1, to_block: 100 },
	{ dataset: "transactions", from_block: 101, to_block: 200 },
];

describe("torn archive import resume", () => {
	test("fresh empty database starts from the first partition", () => {
		expect(
			planTornImport({
				hasIndexProgress: false,
				maxBlockHeight: null,
				partitions,
			}),
		).toEqual({ action: "fresh" });
	});

	test("refuses a completed bootstrap", () => {
		const plan = planTornImport({
			hasIndexProgress: true,
			maxBlockHeight: 200,
			partitions,
		});
		expect(plan.action).toBe("refuse");
	});

	test("resumes after a sealed partition", () => {
		const plan = planTornImport({
			hasIndexProgress: false,
			maxBlockHeight: 100,
			partitions,
		});
		expect(plan).toEqual({
			action: "resume",
			truncateFrom: null,
			skipThrough: 100,
		});
		expect(
			partitionIsLoaded(
				{ dataset: "blocks", from_block: 1, to_block: 100 },
				100,
			),
		).toBe(true);
		expect(
			partitionIsLoaded(
				{ dataset: "blocks", from_block: 101, to_block: 200 },
				100,
			),
		).toBe(false);
	});

	test("truncates a torn mid-partition range", () => {
		const plan = planTornImport({
			hasIndexProgress: false,
			maxBlockHeight: 150,
			partitions,
		});
		expect(plan).toEqual({
			action: "resume",
			truncateFrom: 101,
			skipThrough: 100,
		});
	});
});
