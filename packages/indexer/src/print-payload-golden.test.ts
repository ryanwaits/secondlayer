import { describe, expect, test } from "bun:test";
import {
	countDiverging,
	goldenLine,
	parseArgs,
	parseGoldenFile,
	parseHeights,
} from "./print-payload-golden.ts";

async function* lines(values: string[]): AsyncGenerator<string> {
	for (const value of values) yield value;
}

describe("print golden heights", () => {
	test("lists and inclusive ranges expand sorted and de-duplicated", () => {
		expect(parseHeights("5,7-9,5")).toEqual([5, 7, 8, 9]);
	});

	test("a reversed range is refused", () => {
		expect(() => parseHeights("9-7")).toThrow(/invalid heights/);
	});

	test("a table outside the allowlist is refused", () => {
		expect(() => parseArgs(["--table", "blocks", "--heights", "1"])).toThrow(
			/--table must be one of/,
		);
	});
});

describe("print golden compare", () => {
	const row = {
		cursor: "10:0",
		payload: { topic: "print", value: "x", raw_value: null },
		raw_value: null,
	};

	test("the same rows read twice have no divergence", async () => {
		const expected = parseGoldenFile(`${goldenLine(row)}\n`);
		expect(await countDiverging(lines([goldenLine(row)]), expected)).toBe(0);
	});

	test("a changed served payload, an extra row and a missing row each diverge", async () => {
		const expected = parseGoldenFile(
			`${goldenLine(row)}\n99:0\t${"1".repeat(64)}\n`,
		);
		const changed = goldenLine({
			...row,
			payload: { ...row.payload, value: "y" },
		});
		const extra = goldenLine({ ...row, cursor: "11:0" });
		expect(await countDiverging(lines([changed, extra]), expected)).toBe(3);
	});
});
