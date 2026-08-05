import { afterEach, describe, expect, mock, test } from "bun:test";

// revalidateTag() reaches into Next's request-scoped tracer, which isn't
// present when a route handler is imported and called directly outside a
// real Next server — stub it so the route's post-success side effect
// doesn't crash the handler under test.
mock.module("next/cache", () => ({
	revalidateTag: () => {},
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function authedRequest(body: unknown) {
	return new Request("http://localhost/api/subgraphs/my-graph/backfill", {
		method: "POST",
		headers: { cookie: "sl_session=test-token" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/subgraphs/[name]/backfill", () => {
	test("forwards fromBlock/toBlock to the upstream backfill path", async () => {
		let capturedUrl = "";
		let capturedBody: unknown;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			capturedUrl = String(url);
			capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
			return new Response(JSON.stringify({ status: "queued" }), {
				status: 200,
			});
		}) as typeof fetch;

		const { POST } = await import("./route");
		const req = authedRequest({ fromBlock: 185000, toBlock: 187421 });
		const res = await POST(req, {
			params: Promise.resolve({ name: "my-graph" }),
		});

		expect(res.status).toBe(200);
		expect(capturedUrl).toContain("/api/subgraphs/my-graph/backfill");
		expect(capturedBody).toEqual({ fromBlock: 185000, toBlock: 187421 });
	});
});
