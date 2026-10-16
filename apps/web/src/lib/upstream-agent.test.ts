import { afterEach, expect, test } from "bun:test";
import { apiRequest } from "./api";
import { upstreamAgent } from "./upstream-agent";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("apiRequest sends upstream reads through the shared keep-alive agent", async () => {
	let init: (RequestInit & { dispatcher?: unknown }) | undefined;
	globalThis.fetch = (async (_url: string, i?: RequestInit) => {
		init = i;
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	}) as typeof fetch;

	await apiRequest("/api/status");

	expect(init?.dispatcher).toBe(upstreamAgent);
});
