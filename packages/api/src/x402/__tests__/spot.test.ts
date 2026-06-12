import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { X402_NETWORK, X402_TOKENS } from "@secondlayer/shared/x402";
import { buildAccepts } from "../middleware.ts";
import {
	_refreshX402SpotForTests,
	_resetX402SpotForTests,
	spotUsd,
} from "../spot.ts";

const realFetch = globalThis.fetch;

describe("spotUsd", () => {
	beforeEach(() => {
		_resetX402SpotForTests();
		// biome-ignore lint/performance/noDelete: tests need the env truly absent
		delete process.env.X402_SPOT_SBTC_USD;
		// biome-ignore lint/performance/noDelete: tests need the env truly absent
		delete process.env.X402_SPOT_STX_USD;
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
		_resetX402SpotForTests();
	});

	test("USDCx is the dollar peg (always 1, no feed)", () => {
		expect(spotUsd("USDCx")).toBe(1);
	});

	test("cold cache + no env override → null (asset gets dropped)", () => {
		globalThis.fetch = (async () =>
			new Response("{}", { status: 200 })) as unknown as typeof fetch;
		expect(spotUsd("sBTC")).toBeNull();
		expect(spotUsd("STX")).toBeNull();
	});

	test("env override is used as the fallback when there's no live value", () => {
		process.env.X402_SPOT_SBTC_USD = "65000";
		expect(spotUsd("sBTC")).toBe(65000);
	});

	test("serves the live feed value once refreshed", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ bitcoin: { usd: 64000 }, blockstack: { usd: 1.85 } }),
				{ status: 200 },
			)) as unknown as typeof fetch;
		await _refreshX402SpotForTests();
		expect(spotUsd("sBTC")).toBe(64000);
		expect(spotUsd("STX")).toBe(1.85);
	});

	test("a failed refresh is throttled — price reads don't re-fire the feed (retry-storm guard)", async () => {
		// Reproduces the prod outage: CoinGecko 429s, and every request used to
		// re-fire a refresh (fetchedAt never advanced on failure) → permanent
		// 429 storm → cache never populated. After one failed attempt, further
		// `spotUsd()` reads must NOT hit the feed again until the backoff elapses.
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			return new Response("", { status: 429 });
		}) as unknown as typeof fetch;

		await _refreshX402SpotForTests(); // attempt #1 → 429
		expect(calls).toBe(1);

		// These reads happen well inside the post-failure backoff window.
		spotUsd("STX");
		spotUsd("STX");
		spotUsd("sBTC");
		expect(calls).toBe(1); // no second feed hit — throttled
	});
});

describe("buildAccepts degrades to USDCx-only when sBTC/STX can't be priced", () => {
	test("a null-spot resolver → only the USDCx offer", () => {
		const accepts = buildAccepts({
			surface: "index",
			payTo: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			nonce: "n1",
			network: X402_NETWORK.mainnet,
			spot: () => null, // no live price + no override → sBTC/STX omitted
		});
		expect(accepts).toHaveLength(1);
		expect(accepts[0]?.asset).toBe(X402_TOKENS.USDCx.asset);
		expect(accepts[0]?.amount).toBe("1000"); // $0.001 * 1e6, exact (peg)
	});

	test("a spot resolver prices sBTC + STX alongside USDCx", () => {
		const accepts = buildAccepts({
			surface: "index",
			payTo: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
			nonce: "n1",
			network: X402_NETWORK.mainnet,
			spot: (s) => (s === "sBTC" ? 64000 : s === "STX" ? 1.85 : null),
		});
		const assets = accepts.map((a) => a.asset).sort();
		expect(assets).toEqual(
			[
				X402_TOKENS.STX.asset,
				X402_TOKENS.sBTC.asset,
				X402_TOKENS.USDCx.asset,
			].sort(),
		);
	});
});
