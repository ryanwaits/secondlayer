import { describe, expect, test } from "bun:test";
import {
	barsRows,
	formatAxis,
	formatUsdTick,
	heatGrid,
	hourWindowLabel,
	niceMax,
	spendProjection,
} from "./dashboard-charts";

const NOW = Date.parse("2026-10-15T19:10:00Z");
const HOURS = Array.from({ length: 168 }, (_, i) => ({ n: i, f: 0 }));

describe("niceMax", () => {
	test("rounds up to 1/2/5/10 steps", () => {
		expect(niceMax(7)).toBe(10);
		expect(niceMax(1.4)).toBe(2);
		expect(niceMax(130)).toBe(200);
	});
	test("never returns zero or NaN", () => {
		expect(niceMax(0)).toBeGreaterThan(0);
		expect(niceMax(-3)).toBeGreaterThan(0);
		expect(niceMax(Number.NaN)).toBeGreaterThan(0);
	});
});

describe("formatAxis", () => {
	test("appends a unit when given", () => {
		expect(formatAxis(5.9, "s")).toBe("5.9s");
	});
	test("compacts counts without a unit", () => {
		expect(formatAxis(950)).toBe("950");
		expect(formatAxis(1500)).toBe("1.5k");
		expect(formatAxis(2_000_000)).toBe("2M");
	});
});

describe("formatUsdTick", () => {
	test("prints the origin as $0", () => {
		expect(formatUsdTick(0)).toBe("$0");
	});
	test("keeps one decimal under $10", () => {
		expect(formatUsdTick(2.5)).toBe("$2.5");
	});
	test("rounds to whole dollars from $10", () => {
		expect(formatUsdTick(25)).toBe("$25");
	});
});

describe("heatGrid", () => {
	const { days } = heatGrid(HOURS, NOW);
	test("lays the window on 8 UTC calendar days starting Thu 8", () => {
		expect(days).toHaveLength(8);
		expect(days[0]?.label).toBe("Thu 8");
	});
	test("the first row is null until the window starts at 20:00", () => {
		const first = days[0]?.cells ?? [];
		expect(first.slice(0, 20).every((c) => c === null)).toBe(true);
		expect(first[20]?.index).toBe(0);
	});
	test("the window ends at the current hour, later cells are null", () => {
		const last = days[7]?.cells ?? [];
		expect(last[19]?.index).toBe(167);
		expect(last[20]).toBeNull();
	});
	test("covers each of the 168 hours exactly once", () => {
		const idx = days
			.flatMap((d) => d.cells)
			.flatMap((c) => (c ? [c.index] : []));
		expect(idx).toHaveLength(168);
		expect(new Set(idx).size).toBe(168);
	});
});

describe("hourWindowLabel", () => {
	test("wraps midnight as 23:00-00:00", () => {
		expect(hourWindowLabel(3, NOW)).toBe("Thu, Oct 8 · 23:00–00:00 UTC");
	});
});

describe("spendProjection", () => {
	test("projects at the mean of the last 7 days", () => {
		const p = spendProjection([1, 1, 1, 1, 1, 1, 1, 2], 31);
		expect(p.ratePerDay).toBeCloseTo((1 * 6 + 2) / 7);
		expect(p.spent).toBe(9);
		expect(p.cumulative.at(-1)).toBe(9);
		expect(p.projectedEnd).toBeCloseTo(9 + p.ratePerDay * 23);
	});
	test("uses all days when fewer than 7", () => {
		expect(spendProjection([2, 4], 30).ratePerDay).toBe(3);
	});
	test("handles no data", () => {
		expect(spendProjection([], 30).projectedEnd).toBe(0);
	});
});

describe("barsRows", () => {
	test("passes highlight through and computes the band range", () => {
		const rows = barsRows([{ n: 3 }, { n: 5, f: 1 }], {
			band: [
				[1, 4],
				[2, 9],
			],
			highlight: [1],
		});
		expect(rows[0]).toMatchObject({
			n: 3,
			p: 0,
			bandLow: 1,
			bandRange: 3,
			highlighted: false,
		});
		expect(rows[1]).toMatchObject({
			f: 1,
			bandLow: 2,
			bandRange: 7,
			highlighted: true,
		});
	});
	test("leaves the band null when none is given", () => {
		expect(barsRows([{ n: 1 }])[0]?.bandLow).toBeNull();
	});
});
