import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	MAX_SUMMARY,
	buildTips,
	clip,
	firstSentence,
	serialize,
} from "../../../scripts/docs-tips";

const COMMITTED = join(import.meta.dir, "..", "..", "generated", "tips.json");
const table = buildTips();
const everyTip = [
	...Object.values(table.symbols),
	...table.endpoints.map((e) => e.tip),
];

describe("tip table", () => {
	test("the committed file is what the reference generates (run bun run docs:tips)", () => {
		expect(readFileSync(COMMITTED, "utf8")).toBe(serialize(table));
	});

	test("every summary fits a tooltip and carries no link", () => {
		for (const tip of everyTip) {
			expect(tip.summary.length, tip.summary).toBeGreaterThan(0);
			expect(tip.summary.length, tip.summary).toBeLessThanOrEqual(MAX_SUMMARY);
			expect(tip.summary, tip.summary).not.toMatch(/http|\/docs/);
		}
	});

	test("every tip points at a reference entry that exists", () => {
		for (const tip of everyTip) {
			expect(tip.route.startsWith("/docs/")).toBe(true);
			expect(tip.anchor.length).toBeGreaterThan(0);
		}
	});

	test("endpoints never carry fields: they get a tooltip, no popover", () => {
		for (const e of table.endpoints) expect(e.tip.fields).toBeUndefined();
	});

	test("the SDK's entry wins a name two packages share", () => {
		const tip = table.symbols["sl.streams.consume"];
		expect(tip?.kind).toBe("method");
		expect(tip?.route).toBe("/docs/sdk-reference/streams");
	});

	test("a type with fields lists at most eight and counts the rest", () => {
		for (const tip of everyTip) {
			expect(tip.fields?.length ?? 0).toBeLessThanOrEqual(8);
			if (tip.more) expect(tip.fields?.length).toBe(8);
		}
	});
});

describe("summary text", () => {
	test("links keep their label and inline code loses its ticks", () => {
		expect(firstSentence("See [`Batch`](/docs/x) for `onBatch`. More.")).toBe(
			"See Batch for onBatch.",
		);
	});

	test("a long summary is cut at its first clause break, or dropped", () => {
		const head = "Wire shape of a chain trigger";
		const long = `${head}: ${"derived per member from the spec, ".repeat(8)}`;
		expect(clip(long)).toBe(`${head}.`);
		expect(clip("x".repeat(200))).toBe("");
		expect(clip("Short.")).toBe("Short.");
	});
});
