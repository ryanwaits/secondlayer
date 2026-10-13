import { describe, expect, test } from "bun:test";
import { formatCount, manifestRows } from "./chain-stats";
import { readEventsTotal } from "./status-fields";

describe("readEventsTotal", () => {
	test("reads index.events_total from a status body", () => {
		expect(readEventsTotal({ index: { events_total: 294_300_251 } })).toBe(
			294_300_251,
		);
	});

	test("is null when the field is missing or not a finite number", () => {
		expect(readEventsTotal({ index: { status: "ok" } })).toBeNull();
		expect(readEventsTotal({ index: { events_total: null } })).toBeNull();
		expect(readEventsTotal({ index: { events_total: "12" } })).toBeNull();
		expect(readEventsTotal(null)).toBeNull();
	});
});

describe("manifestRows", () => {
	const counts = {
		blocks: 9_137_865,
		transactions: 29_861_044,
		events: 294_300_251,
		toBlock: 9_137_864,
	};

	test("shares of the set add up to 100 within rounding", () => {
		const total = manifestRows(counts).reduce((n, r) => n + r.share, 0);
		expect(Math.abs(total - 100)).toBeLessThan(0.05);
	});

	test("every row carries the signed coverage and a grouped count", () => {
		for (const row of manifestRows(counts)) {
			expect(row.coverage).toBe("0 → 9,137,864");
		}
		expect(manifestRows(counts)[0].rows).toBe(formatCount(294_300_251));
	});
});
