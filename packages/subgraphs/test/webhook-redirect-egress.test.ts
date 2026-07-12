import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	MAX_REDIRECT_HOPS,
	__setDnsLookupForTest,
	__postToSubscriptionForTest as postToSubscription,
} from "../src/runtime/emitter.ts";

// Pure transport-layer tests: stub `fetch` and inject DNS resolution so no
// real network call is ever made — same injection seam `ssrf.test.ts` uses
// for the initial-hostname guard, extended here to cover redirect hops.

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
	__setDnsLookupForTest(null);
});

// Every "public" hostname used below resolves to a real public v4 address
// (example.com's) via the injected DNS seam — `checkEgressAllowed` otherwise
// does a real DNS lookup, which would fail (or hang) for these fake `.test`
// hostnames. The metadata-IP case needs no DNS lookup at all: 169.254.169.254
// is rejected as a literal address before DNS is ever consulted.
beforeEach(() => {
	__setDnsLookupForTest(async () => [{ address: "93.184.216.34", family: 4 }]);
});

/** Build a stub `fetch` from an ordered list of per-call responses, keyed by
 *  call index. Throws if called more times than responses were provided —
 *  that's how tests assert an upper bound on fetches issued. */
function stubFetch(
	responses: Array<{ status: number; location?: string; body?: string }>,
): { fetch: typeof fetch; calls: string[] } {
	const calls: string[] = [];
	const fn = (async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		calls.push(url);
		const idx = calls.length - 1;
		if (idx >= responses.length) {
			throw new Error(`unexpected extra fetch call #${idx + 1} to ${url}`);
		}
		// biome-ignore lint/style/noNonNullAssertion: idx is bounds-checked above
		const r = responses[idx]!;
		const headers: Record<string, string> = {};
		if (r.location) headers.location = r.location;
		return new Response(r.body ?? null, { status: r.status, headers });
	}) as unknown as typeof fetch;
	return { fetch: fn, calls };
}

describe("webhook redirect egress guard", () => {
	it("refuses a redirect to a private/metadata address and never issues the second fetch", async () => {
		const { fetch, calls } = stubFetch([
			{
				status: 302,
				location: "http://169.254.169.254/latest/meta-data/",
			},
		]);
		globalThis.fetch = fetch;

		const result = await postToSubscription(
			"http://public.example.test/hook",
			"{}",
			{},
			5_000,
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("refused private egress");
		expect(result.responseBody).toBeNull();
		expect(result.responseHeaders).toBeNull();
		// Only the first (public) hop was ever fetched — the metadata
		// address must never be reached.
		expect(calls).toEqual(["http://public.example.test/hook"]);
	});

	it("follows a redirect to a public address and delivers the final response", async () => {
		const { fetch, calls } = stubFetch([
			{ status: 302, location: "http://public2.example.test/hook2" },
			{ status: 200, body: "ok-from-final-hop" },
		]);
		globalThis.fetch = fetch;

		const result = await postToSubscription(
			"http://public.example.test/hook",
			"{}",
			{},
			5_000,
		);

		expect(result.ok).toBe(true);
		expect(result.statusCode).toBe(200);
		expect(result.responseBody).toBe("ok-from-final-hop");
		expect(calls).toEqual([
			"http://public.example.test/hook",
			"http://public2.example.test/hook2",
		]);
	});

	it("fails cleanly when the redirect chain exceeds the hop budget", async () => {
		// Every hop redirects to the next public host — chain never terminates.
		const responses = Array.from({ length: MAX_REDIRECT_HOPS + 2 }, (_, i) => ({
			status: 302,
			location: `http://public-${i + 1}.example.test/hook`,
		}));
		const { fetch, calls } = stubFetch(responses);
		globalThis.fetch = fetch;

		const result = await postToSubscription(
			"http://public-0.example.test/hook",
			"{}",
			{},
			5_000,
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("redirect");
		expect(calls.length).toBeLessThanOrEqual(MAX_REDIRECT_HOPS);
	});

	it("leaves a plain (non-redirect) delivery unchanged", async () => {
		const { fetch, calls } = stubFetch([{ status: 200, body: "hello" }]);
		globalThis.fetch = fetch;

		const result = await postToSubscription(
			"http://public.example.test/hook",
			"{}",
			{},
			5_000,
		);

		expect(result.ok).toBe(true);
		expect(result.statusCode).toBe(200);
		expect(result.responseBody).toBe("hello");
		expect(result.responseHeaders).not.toBeNull();
		expect(calls).toEqual(["http://public.example.test/hook"]);
	});
});
