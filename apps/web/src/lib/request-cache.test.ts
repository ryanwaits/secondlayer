import { afterEach, describe, expect, test } from "bun:test";
import { clearRequestCache, isFresh, markFresh, shared } from "./request-cache";

const realNow = Date.now;
afterEach(() => {
	Date.now = realNow;
	clearRequestCache();
});

describe("shared", () => {
	test("concurrent calls with one key run once and share the value", async () => {
		let runs = 0;
		const fn = async () => {
			runs++;
			await Promise.resolve();
			return { n: runs };
		};
		const [a, b] = await Promise.all([shared("k", fn), shared("k", fn)]);
		expect(runs).toBe(1);
		expect(a).toBe(b);
	});

	test("runs again once the first call has settled", async () => {
		let runs = 0;
		const fn = async () => ++runs;
		await shared("k", fn);
		await shared("k", fn);
		expect(runs).toBe(2);
	});

	test("a rejected run does not stick", async () => {
		await expect(
			shared("k", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await shared("k", async () => "ok")).toBe("ok");
	});
});

describe("freshness", () => {
	test("fresh right after markFresh, stale after the window", () => {
		let now = 1_000;
		Date.now = () => now;
		expect(isFresh("k")).toBe(false);
		markFresh("k");
		expect(isFresh("k")).toBe(true);
		now += 5_000;
		expect(isFresh("k", 5_000)).toBe(false);
		expect(isFresh("k", 6_000)).toBe(true);
	});

	test("clearRequestCache forgets freshness", () => {
		markFresh("k");
		clearRequestCache();
		expect(isFresh("k")).toBe(false);
	});
});
