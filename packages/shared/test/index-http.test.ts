import { afterEach, expect, test } from "bun:test";
import {
	IndexHttpClient,
	createInternalIndexHttpClient,
} from "../src/index-http.ts";

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
	}) as unknown as typeof fetch;

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
	}) as unknown as typeof fetch;

	const tip = await client().getStreamsTip();
	expect(tip).toBe(42);
	expect(calls).toBe(2);
});

test("does NOT retry a 404 — throws immediately", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response("nope", { status: 404 });
	}) as unknown as typeof fetch;

	await expect(client().getStreamsTip()).rejects.toThrow("404");
	expect(calls).toBe(1);
});

test("gives up after MAX_ATTEMPTS of persistent transport failure", async () => {
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		throw new Error("ECONNREFUSED");
	}) as unknown as typeof fetch;

	await expect(client().getStreamsTip()).rejects.toThrow("ECONNREFUSED");
	expect(calls).toBe(4);
});

test("createInternalIndexHttpClient omits bearer when internal env and INSTANCE_TOKEN are empty", async () => {
	const saved = {
		STREAMS_INTERNAL_API_KEY: process.env.STREAMS_INTERNAL_API_KEY,
		INDEX_INTERNAL_API_KEY: process.env.INDEX_INTERNAL_API_KEY,
		INSTANCE_TOKEN: process.env.INSTANCE_TOKEN,
		SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
		STREAMS_API_URL: process.env.STREAMS_API_URL,
	};
	process.env.STREAMS_INTERNAL_API_KEY = "";
	process.env.INDEX_INTERNAL_API_KEY = "";
	process.env.INSTANCE_TOKEN = "";
	process.env.SUBGRAPH_INDEX_API_URL = "";
	process.env.STREAMS_API_URL = "";

	const captured = { auth: null as string | null, url: "" };
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		captured.url = String(input);
		captured.auth = new Headers(init?.headers).get("authorization");
		return okTip();
	}) as unknown as typeof fetch;

	try {
		await createInternalIndexHttpClient().getStreamsTip();
		expect(captured.url).toBe("http://api:3800/v1/streams/tip");
		expect(captured.auth).toBeNull();
	} finally {
		restoreEnv(saved);
	}
});

test("createInternalIndexHttpClient sends INSTANCE_TOKEN when STREAMS_INTERNAL_API_KEY is empty", async () => {
	const saved = {
		STREAMS_INTERNAL_API_KEY: process.env.STREAMS_INTERNAL_API_KEY,
		INDEX_INTERNAL_API_KEY: process.env.INDEX_INTERNAL_API_KEY,
		INSTANCE_TOKEN: process.env.INSTANCE_TOKEN,
		SUBGRAPH_INDEX_API_URL: process.env.SUBGRAPH_INDEX_API_URL,
		STREAMS_API_URL: process.env.STREAMS_API_URL,
	};
	process.env.STREAMS_INTERNAL_API_KEY = "";
	process.env.INDEX_INTERNAL_API_KEY = "";
	process.env.INSTANCE_TOKEN = "instance-token";
	process.env.SUBGRAPH_INDEX_API_URL = "";
	process.env.STREAMS_API_URL = "";

	const captured = { auth: null as string | null, url: "" };
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		captured.url = String(input);
		captured.auth = new Headers(init?.headers).get("authorization");
		return okTip();
	}) as unknown as typeof fetch;

	try {
		await createInternalIndexHttpClient().getStreamsTip();
		expect(captured.auth).toBe("Bearer instance-token");
	} finally {
		restoreEnv(saved);
	}
});

function restoreEnv(saved: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}
