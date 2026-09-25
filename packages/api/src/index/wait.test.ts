import { describe, expect, test } from "bun:test";
import {
	longPollIndex,
	parseWaitSeconds,
	startIndexTipWakeListener,
	waitForIndexTipAdvance,
} from "./wait.ts";

describe("parseWaitSeconds", () => {
	test("undefined (param absent) stays undefined — every existing caller keeps today's behavior", () => {
		expect(parseWaitSeconds(undefined)).toBeUndefined();
	});

	test("accepts an in-range integer", () => {
		expect(parseWaitSeconds("10")).toBe(10);
		expect(parseWaitSeconds("0")).toBe(0);
		expect(parseWaitSeconds("25")).toBe(25);
	});

	test("refuses a negative value", () => {
		expect(() => parseWaitSeconds("-1")).toThrow();
	});

	test("refuses a non-integer value", () => {
		expect(() => parseWaitSeconds("1.5")).toThrow();
		expect(() => parseWaitSeconds("abc")).toThrow();
	});

	test("refuses anything past the 25s ceiling", () => {
		expect(() => parseWaitSeconds("26")).toThrow();
	});
});

describe("longPollIndex", () => {
	test("no wait requested — build() runs exactly once, even on an empty result", async () => {
		let calls = 0;
		const result = await longPollIndex({
			waitSeconds: undefined,
			isEmpty: () => true,
			build: async () => {
				calls++;
				return { rows: [] as number[] };
			},
		});
		expect(calls).toBe(1);
		expect(result.rows).toEqual([]);
	});

	test("wait requested but the first build() already has data — returns immediately, no waiting", async () => {
		let calls = 0;
		const start = Date.now();
		const result = await longPollIndex({
			waitSeconds: 5,
			isEmpty: (r: { rows: number[] }) => r.rows.length === 0,
			build: async () => {
				calls++;
				return { rows: [1] };
			},
		});
		expect(calls).toBe(1);
		expect(result.rows).toEqual([1]);
		expect(Date.now() - start).toBeLessThan(500);
	});

	test("wait requested and every build() stays empty — waits out the full budget once, then answers with whatever the last attempt returned", async () => {
		let calls = 0;
		const start = Date.now();
		const result = await longPollIndex({
			waitSeconds: 0.3,
			isEmpty: (r: { rows: number[] }) => r.rows.length === 0,
			build: async () => {
				calls++;
				return { rows: [] as number[] };
			},
		});
		expect(calls).toBe(2); // the initial check + exactly one post-wait retry
		expect(result.rows).toEqual([]);
		expect(Date.now() - start).toBeGreaterThanOrEqual(250);
	});

	test("wait requested and a later build() finds data — returns that data instead of an empty one", async () => {
		let calls = 0;
		const result = await longPollIndex({
			waitSeconds: 0.2,
			isEmpty: (r: { rows: number[] }) => r.rows.length === 0,
			build: async () => {
				calls++;
				return { rows: calls >= 2 ? [42] : [] };
			},
		});
		expect(result.rows).toEqual([42]);
	});
});

describe("waitForIndexTipAdvance", () => {
	test("0 or undefined resolves immediately", async () => {
		const start = Date.now();
		await waitForIndexTipAdvance(undefined);
		await waitForIndexTipAdvance(0);
		expect(Date.now() - start).toBeLessThan(100);
	});

	test("without a connected wake bus, waits out the full duration (degrades to a plain timeout)", async () => {
		const start = Date.now();
		await waitForIndexTipAdvance(0.2);
		expect(Date.now() - start).toBeGreaterThanOrEqual(180);
	});
});

describe("startIndexTipWakeListener degrades safely", () => {
	test("a bad connection string never throws synchronously — the caller doesn't need to catch it", () => {
		expect(() =>
			startIndexTipWakeListener({
				connectionString: "postgres://bad-host-does-not-resolve:5432/nope",
			}),
		).not.toThrow();
	});
});
