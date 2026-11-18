import { describe, expect, test } from "bun:test";
import { createMemoizedReader } from "./memoized-reader.ts";

describe("createMemoizedReader", () => {
	test("serves the last good value while a refresh fails, within staleMs", async () => {
		let at = 0;
		let fail = false;
		const read = createMemoizedReader(
			async () => {
				if (fail) throw new Error("down");
				return "a";
			},
			{ now: () => at, ttlMs: 10, staleMs: 100 },
		);
		expect(await read()).toBe("a");
		fail = true;
		at = 20;
		expect(await read()).toBe("a");
	});

	test("returns null once the last good value is older than staleMs and the refresh fails", async () => {
		let at = 0;
		let fail = false;
		const read = createMemoizedReader(
			async () => {
				if (fail) throw new Error("down");
				return "a";
			},
			{ now: () => at, ttlMs: 10, staleMs: 100 },
		);
		expect(await read()).toBe("a");
		fail = true;
		at = 200;
		expect(await read()).toBeNull();
	});

	test("runs one refresh at a time", async () => {
		let calls = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const read = createMemoizedReader(async () => {
			calls++;
			await gate;
			return "x";
		});
		const all = Promise.all([read(), read(), read()]);
		release();
		expect(await all).toEqual(["x", "x", "x"]);
		expect(calls).toBe(1);
	});

	test("waits at most waitMs when nothing is cached", async () => {
		const read = createMemoizedReader(() => new Promise<string>(() => {}), {
			waitMs: 20,
		});
		const started = Date.now();
		expect(await read()).toBeNull();
		expect(Date.now() - started).toBeLessThan(500);
	});

	test("a refresh that times out still fills the cache when it finishes", async () => {
		let calls = 0;
		const read = createMemoizedReader(
			async () => {
				calls++;
				await new Promise((resolve) => setTimeout(resolve, 50));
				return "slow";
			},
			{ waitMs: 10 },
		);
		expect(await read()).toBeNull();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(await read()).toBe("slow");
		expect(calls).toBe(1);
	});

	test("calls onError with the failure", async () => {
		const seen: unknown[] = [];
		const failure = new Error("boom");
		const read = createMemoizedReader(
			async () => {
				throw failure;
			},
			{ onError: (error) => seen.push(error) },
		);
		expect(await read()).toBeNull();
		expect(seen).toEqual([failure]);
	});
});
