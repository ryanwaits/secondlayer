import { describe, expect, it } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../types.ts";
import { cachedRegistryClassifiedThrough } from "./contracts.ts";

function setup() {
	const state = { queries: 0, clock: 1_000_000, fail: false, value: 100 };
	const db = {} as unknown as Kysely<Database>;
	const opts = {
		now: () => state.clock,
		read: async () => {
			state.queries++;
			await Promise.resolve();
			if (state.fail) throw new Error("db down");
			return state.value;
		},
	};
	return { state, db, opts };
}

/** Let a background refresh settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("cachedRegistryClassifiedThrough", () => {
	it("shares one query between callers in the same window", async () => {
		const { state, db, opts } = setup();

		const [first, second] = await Promise.all([
			cachedRegistryClassifiedThrough(db, opts),
			cachedRegistryClassifiedThrough(db, opts),
		]);
		expect([first, second]).toEqual([100, 100]);
		state.clock += 5_000;
		await cachedRegistryClassifiedThrough(db, opts);
		expect(state.queries).toBe(1);
	});

	it("returns the previous value at once when stale and refreshes once in the background", async () => {
		const { state, db, opts } = setup();
		await cachedRegistryClassifiedThrough(db, opts);
		state.clock += 15_001;
		state.value = 140;

		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(100);
		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(100);
		await settle();
		expect(state.queries).toBe(2);
		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(140);
		expect(state.queries).toBe(2);
	});

	it("does not cache a failed first query", async () => {
		const { state, db, opts } = setup();
		state.fail = true;
		await expect(cachedRegistryClassifiedThrough(db, opts)).rejects.toThrow(
			"db down",
		);
		state.fail = false;

		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(100);
		expect(state.queries).toBe(2);
	});

	it("keeps serving the previous value when a background refresh fails, then retries", async () => {
		const { state, db, opts } = setup();
		await cachedRegistryClassifiedThrough(db, opts);
		state.clock += 15_001;
		state.fail = true;

		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(100);
		await settle();
		state.fail = false;
		state.value = 150;
		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(100);
		await settle();
		expect(await cachedRegistryClassifiedThrough(db, opts)).toBe(150);
	});
});
