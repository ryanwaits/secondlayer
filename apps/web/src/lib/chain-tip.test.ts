import { describe, expect, test } from "bun:test";
import { EMPTY_TIP, nextTip, readTip, staleness } from "./chain-tip";

describe("nextTip", () => {
	test("first read seeds seenAt from lag_seconds without a beat", () => {
		const t = nextTip(EMPTY_TIP, 100, 15, 1_000_000);
		expect(t.height).toBe(100);
		expect(t.seenAt).toBe(985_000);
		expect(t.beat).toBe(0);
		expect(t.intervals).toEqual([]);
	});

	test("an unchanged height returns the same object", () => {
		const a = nextTip(EMPTY_TIP, 100, 0, 0);
		expect(nextTip(a, 100, 0, 5_000)).toBe(a);
	});

	test("two height changes give an average block time", () => {
		let t = nextTip(EMPTY_TIP, 100, 0, 0);
		t = nextTip(t, 101, 0, 8_000);
		expect(t.avgBlockSec).toBeNull();
		t = nextTip(t, 102, 0, 18_000);
		expect(t.avgBlockSec).toBe(9);
		expect(t.beat).toBe(2);
	});

	test("keeps only the last 10 intervals", () => {
		let t = nextTip(EMPTY_TIP, 0, 0, 0);
		for (let i = 1; i <= 12; i++) t = nextTip(t, i, 0, i * 1000);
		expect(t.intervals).toHaveLength(10);
	});
});

describe("staleness", () => {
	const tip = nextTip(EMPTY_TIP, 1, 0, 0);
	test("fresh, stale and down boundaries", () => {
		expect(staleness(tip, 59_000).level).toBe("fresh");
		expect(staleness(tip, 61_000).level).toBe("stale");
		expect(staleness(tip, 601_000).level).toBe("down");
	});
});

describe("readTip", () => {
	test("reads height and lag", () => {
		expect(
			readTip({ streams: { tip: { block_height: 5, lag_seconds: 3 } } }),
		).toEqual({ height: 5, lagSeconds: 3 });
	});
	test("tolerates missing lag and rejects a bad height", () => {
		expect(readTip({ streams: { tip: { block_height: 5 } } })?.lagSeconds).toBe(
			null,
		);
		expect(readTip({ streams: { tip: { block_height: "x" } } })).toBeNull();
		expect(readTip(null)).toBeNull();
	});
});
