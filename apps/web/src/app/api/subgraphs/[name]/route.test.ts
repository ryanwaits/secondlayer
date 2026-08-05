import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function authedRequest(path: string) {
	return new Request(`http://localhost${path}`, {
		headers: { cookie: "sl_session=test-token" },
	});
}

// Empirically verified against a live `next dev` server proxying to a mock
// upstream: a request to /api/subgraphs/..%2Fadmin%2Faccounts reached the
// upstream at /api/admin/accounts, carrying this caller's own bearer token.
// Next decodes a dynamic segment before handing it to the route, and the
// WHATWG URL parser `fetch` uses then resolves the ".." — encodeURIComponent
// alone does not stop this because it never escapes ".". This test
// reproduces that exact shape at the handler layer and asserts the guard in
// apiRequest now rejects it instead of forwarding the request upstream.
describe("GET /api/subgraphs/[name] path traversal", () => {
	test("a name that decodes to a parent-directory segment is rejected, not forwarded", async () => {
		let fetchCalled = false;
		globalThis.fetch = (async (_url: string) => {
			fetchCalled = true;
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const { GET } = await import("./route");
		// Next decodes dynamic route segments before params reach the handler,
		// so this is the value the handler actually sees for a request to
		// /api/subgraphs/..%2Fadmin%2Faccounts.
		const res = await GET(authedRequest("/api/subgraphs/../admin/accounts"), {
			params: Promise.resolve({ name: "../admin/accounts" }),
		});

		expect(res.status).toBe(400);
		expect(fetchCalled).toBe(false);
	});

	test("an ordinary name is still forwarded to the upstream subgraph path", async () => {
		let capturedUrl = "";
		globalThis.fetch = (async (url: string) => {
			capturedUrl = String(url);
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof fetch;

		const { GET } = await import("./route");
		const res = await GET(authedRequest("/api/subgraphs/my-graph"), {
			params: Promise.resolve({ name: "my-graph" }),
		});

		expect(res.status).toBe(200);
		expect(capturedUrl).toContain("/api/subgraphs/my-graph");
	});
});
