import { afterEach, expect, test } from "bun:test";
import { apiRequest } from "./api";
import { upstreamAgent } from "./upstream-agent";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("a second load of the module (another server bundle) gets the same agent", async () => {
	// The query string makes Bun load a second copy of the module.
	const specifier = "./upstream-agent.ts?second-bundle";
	const copy = (await import(specifier)) as { upstreamAgent: unknown };
	expect(copy.upstreamAgent).toBe(upstreamAgent);
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
