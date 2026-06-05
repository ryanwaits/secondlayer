import { afterEach, describe, expect, test } from "bun:test";
import { IndexHttpClient } from "../src/index-http.ts";

/**
 * Transport-retry behavior of IndexHttpClient — makes a single api-replica
 * recreate transparent to the streams-index processors (processors-depend-on-api).
 */

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function client(): IndexHttpClient {
	return new IndexHttpClient({
		indexBaseUrl: "http://api:3800",
		streamsBaseUrl: "http://api:3800",
		streamsApiKey: "k",
	});
}

function okTip() {
	return new Response(JSON.stringify({ block_height: 42 }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

test("retries a thrown fetch (connection reset) then succeeds", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		if (calls < 3) throw new Error("ECONNRESET");
		return okTip();
	}) as typeof fetch;

	const tip = await client().getStreamsTip();
	expect(tip).toBe(42);
	expect(calls).toBe(3);
});

test("retries a 503 then succeeds", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		if (calls < 2) return new Response("unavailable", { status: 503 });
		return okTip();
	}) as typeof fetch;

	const tip = await client().getStreamsTip();
	expect(tip).toBe(42);
	expect(calls).toBe(2);
});

test("does NOT retry a 404 — throws immediately", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response("nope", { status: 404 });
	}) as typeof fetch;

	await expect(client().getStreamsTip()).rejects.toThrow("404");
	expect(calls).toBe(1);
});

test("gives up after MAX_ATTEMPTS of persistent transport failure", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		throw new Error("ECONNREFUSED");
	}) as typeof fetch;

	await expect(client().getStreamsTip()).rejects.toThrow("ECONNREFUSED");
	expect(calls).toBe(4);
});
