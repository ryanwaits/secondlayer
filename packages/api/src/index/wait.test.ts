import { beforeAll, describe, expect, test } from "bun:test";
import { notify } from "@secondlayer/shared/queue/listener";
import {
	currentIndexTipGeneration,
	longPollIndex,
	parseWaitSeconds,
	startIndexTipWakeListener,
	waitForIndexTipAdvance,
} from "./wait.ts";

const HAS_DB = !!process.env.DATABASE_URL;

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

// Real wake bus + real NOTIFY. Placed here — right after the tests above that
// require NO real connection to exist yet, and before the bad-connection-string
// test below (`startIndexTipWakeListener` is a once-per-process singleton: a
// second call while a first connection attempt is still in flight is silently
// dropped, no retry, so a real connection must be established cleanly with
// nothing else racing it).
describe.skipIf(!HAS_DB)(
	"the check-then-wait race is closed (real wake bus)",
	() => {
		beforeAll(async () => {
			startIndexTipWakeListener();
			// `startIndexTipWakeListener` doesn't expose its connect promise —
			// give the real LISTEN a moment to establish before relying on it.
			await new Promise((resolve) => setTimeout(resolve, 300));
		});

		test("waitForIndexTipAdvance returns immediately once the generation has already advanced past sinceGeneration", async () => {
			const before = currentIndexTipGeneration();
			await notify("index:tip", "test");
			await new Promise((resolve) => setTimeout(resolve, 150));
			expect(currentIndexTipGeneration()).toBeGreaterThan(before);

			const start = Date.now();
			await waitForIndexTipAdvance(5, before);
			expect(Date.now() - start).toBeLessThan(200);
		});

		test("a commit that lands right after build() reads stale state still wakes the long-poll immediately, not after the full wait budget", async () => {
			let calls = 0;
			const start = Date.now();
			const result = await longPollIndex({
				waitSeconds: 2,
				isEmpty: (r: { rows: number[] }) => r.rows.length === 0,
				build: async () => {
					calls++;
					if (calls === 1) {
						// Simulate a commit landing the instant after this build() read
						// its (now-stale) state — fully delivered before this call
						// registers its wait(), so a freshly-registered wait() would
						// never see it (the bug this generation check closes).
						await notify("index:tip", "test");
						await new Promise((resolve) => setTimeout(resolve, 150));
						return { rows: [] as number[] };
					}
					return { rows: [42] };
				},
			});
			expect(calls).toBe(2);
			expect(result.rows).toEqual([42]);
			expect(Date.now() - start).toBeLessThan(700);
		});
	},
);

describe("startIndexTipWakeListener degrades safely", () => {
	test("a bad connection string never throws synchronously — the caller doesn't need to catch it", () => {
		expect(() =>
			startIndexTipWakeListener({
				connectionString: "postgres://bad-host-does-not-resolve:5432/nope",
			}),
		).not.toThrow();
	});
});
