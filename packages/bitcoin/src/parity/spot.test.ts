// Fakes-only tests for the daily spot-parity CLI command (plan 062, Gate 2)
// — no live ord instance and no real Postgres. `runSpotParity`'s DB/HTTP
// seams (`fetchCheckpoint`, `fetchOrdHeight`, `fetchTopRuneIds`,
// `fetchOurStats`, `fetchOrdStats`) are all overridden with in-memory fakes,
// the same dependency-injection shape `packages/api/src/bitcoin/db.ts`'s
// `BtcReorgsReader` uses.
import { describe, expect, test } from "bun:test";
import {
	type RuneStats,
	compareRuneStats,
	fetchOrdBlockHeight,
	normalizeOrdRuneEntry,
	runSpotParity,
	waitForOrdCheckpointMatch,
} from "./spot.ts";

function fakeFetch(
	handler: (url: string, init?: RequestInit) => Response,
): typeof fetch {
	return (async (
		input: string | URL | Request,
		init?: RequestInit,
	): Promise<Response> => handler(String(input), init)) as typeof fetch;
}

describe("fetchOrdBlockHeight", () => {
	test("parses ord's plain-text /blockheight response", async () => {
		const doFetch = fakeFetch((url) => {
			expect(url).toBe("http://ord.local/blockheight");
			return new Response("871234\n");
		});
		expect(await fetchOrdBlockHeight("http://ord.local", doFetch)).toBe(871234);
	});

	test("throws on a non-integer body", async () => {
		const doFetch = fakeFetch(() => new Response("not a number"));
		await expect(
			fetchOrdBlockHeight("http://ord.local", doFetch),
		).rejects.toThrow(/non-integer/);
	});

	test("throws on a non-2xx response", async () => {
		const doFetch = fakeFetch(() => new Response("", { status: 503 }));
		await expect(
			fetchOrdBlockHeight("http://ord.local", doFetch),
		).rejects.toThrow(/HTTP 503/);
	});
});

describe("normalizeOrdRuneEntry", () => {
	test("computes supply as premine + mints*terms.amount, ignoring burned", () => {
		const json = JSON.parse(
			JSON.stringify({
				entry: {
					block: 840000,
					burned: "5",
					divisibility: 0,
					etching: "0".repeat(64),
					mints: "10",
					number: 0,
					premine: "1000",
					spaced_rune: "UNCOMMON•GOODS",
					symbol: "⧉",
					terms: { amount: "10", cap: "3" },
					timestamp: 0,
					turbo: true,
				},
				id: "840000:1",
				mintable: true,
				parent: null,
			}),
		);
		const stats = normalizeOrdRuneEntry(json);
		expect(stats).toEqual({
			mints: 10n,
			burned: 5n,
			supply: 1000n + 10n * 10n,
		});
	});

	test("terms: null (no mint terms) yields supply === premine", () => {
		const json = {
			entry: {
				mints: "0",
				burned: "0",
				premine: "42",
				terms: null,
			},
		};
		expect(normalizeOrdRuneEntry(json)).toEqual({
			mints: 0n,
			burned: 0n,
			supply: 42n,
		});
	});

	test("throws when .entry is missing", () => {
		expect(() => normalizeOrdRuneEntry({ id: "1:0" })).toThrow(/\.entry/);
	});
});

describe("compareRuneStats", () => {
	const base: RuneStats = { mints: 10n, burned: 2n, supply: 100n };

	test("no mismatches when every field agrees", () => {
		expect(compareRuneStats("1:0", base, { ...base })).toEqual([]);
	});

	test("reports each differing field independently", () => {
		const ord: RuneStats = { mints: 11n, burned: 2n, supply: 105n };
		const mismatches = compareRuneStats("1:0", base, ord);
		expect(mismatches).toEqual([
			{ runeId: "1:0", field: "mints", ours: "10", ord: "11" },
			{ runeId: "1:0", field: "supply", ours: "100", ord: "105" },
		]);
	});
});

describe("waitForOrdCheckpointMatch", () => {
	function fakeClock(start = 0) {
		let t = start;
		return {
			now: () => t,
			sleep: async (ms: number) => {
				t += ms;
			},
		};
	}

	test("resolves immediately when ord already matches", async () => {
		const { now, sleep } = fakeClock();
		let calls = 0;
		await waitForOrdCheckpointMatch(100, {
			ordUrl: "http://ord.local",
			now,
			sleep,
			fetchHeight: async () => {
				calls += 1;
				return 100;
			},
		});
		expect(calls).toBe(1);
	});

	test("retries on a poll interval until ord catches up", async () => {
		const { now, sleep } = fakeClock();
		const seen: number[] = [100, 100, 101];
		let i = 0;
		await waitForOrdCheckpointMatch(101, {
			ordUrl: "http://ord.local",
			now,
			sleep,
			intervalMs: 1000,
			fetchHeight: async () => seen[i++] as number,
		});
		expect(i).toBe(3);
	});

	test("throws after the timeout elapses without a match", async () => {
		const { now, sleep } = fakeClock();
		await expect(
			waitForOrdCheckpointMatch(999, {
				ordUrl: "http://ord.local",
				now,
				sleep,
				timeoutMs: 5000,
				intervalMs: 1000,
				fetchHeight: async () => 1,
			}),
		).rejects.toThrow(/never reached our checkpoint height 999/);
	});
});

describe("runSpotParity", () => {
	test("reports zero mismatches when ours and ord agree on every top rune", async () => {
		const stats: RuneStats = { mints: 5n, burned: 0n, supply: 500n };
		const result = await runSpotParity({
			// biome-ignore lint/suspicious/noExplicitAny: fake db never touched — every DB seam below is overridden
			db: {} as any,
			ordUrl: "http://ord.local",
			fetchCheckpoint: async () => 900_144,
			fetchOrdHeight: async () => 900_144,
			fetchTopRuneIds: async () => ["840000:1", "840000:2"],
			fetchOurStats: async () =>
				new Map([
					["840000:1", stats],
					["840000:2", stats],
				]),
			fetchOrdStats: async () => ({ ...stats }),
		});
		expect(result).toEqual({
			checkpointHeight: 900_144,
			runesChecked: 2,
			mismatches: [],
		});
	});

	test("reports a mismatch for a rune whose ord stats diverge", async () => {
		const ours: RuneStats = { mints: 5n, burned: 0n, supply: 500n };
		const ord: RuneStats = { mints: 6n, burned: 0n, supply: 600n };
		const result = await runSpotParity({
			// biome-ignore lint/suspicious/noExplicitAny: fake db never touched
			db: {} as any,
			ordUrl: "http://ord.local",
			fetchCheckpoint: async () => 900_144,
			fetchOrdHeight: async () => 900_144,
			fetchTopRuneIds: async () => ["840000:1"],
			fetchOurStats: async () => new Map([["840000:1", ours]]),
			fetchOrdStats: async () => ord,
		});
		expect(result.mismatches).toEqual([
			{ runeId: "840000:1", field: "mints", ours: "5", ord: "6" },
			{ runeId: "840000:1", field: "supply", ours: "500", ord: "600" },
		]);
	});

	test("throws when there is no checkpoint yet, without ever calling ord", async () => {
		let ordCalled = false;
		await expect(
			runSpotParity({
				// biome-ignore lint/suspicious/noExplicitAny: fake db never touched
				db: {} as any,
				ordUrl: "http://ord.local",
				fetchCheckpoint: async () => undefined,
				fetchOrdHeight: async () => {
					ordCalled = true;
					return 0;
				},
			}),
		).rejects.toThrow(/no runes checkpoint yet/);
		expect(ordCalled).toBe(false);
	});
});
