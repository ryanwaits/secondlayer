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

function authedRequest() {
	return new Request("http://localhost/api/subgraphs/my-graph/reindex", {
		method: "POST",
		headers: { cookie: "sl_session=test-token" },
	});
}

describe("POST /api/subgraphs/[name]/reindex", () => {
	// Regression for the incident: the console form used to send
	// fromBlock/toBlock on every submit, which the upstream API now rejects
	// with 400 REINDEX_RANGE_NOT_SUPPORTED. The route (and the form behind it)
	// must never forward those keys — reindex always rebuilds the whole
	// subgraph and takes no range.
	test("does not forward fromBlock/toBlock to the upstream reindex path", async () => {
		let capturedBody: unknown;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			capturedBody = init?.body ? JSON.parse(String(init.body)) : init?.body;
			return new Response(JSON.stringify({ status: "queued" }), {
				status: 200,
			});
		}) as typeof fetch;

		const { POST } = await import("./route");
		const req = authedRequest();
		const res = await POST(req, {
			params: Promise.resolve({ name: "my-graph" }),
		});

		expect(res.status).toBe(200);
		if (capturedBody && typeof capturedBody === "object") {
			expect("fromBlock" in capturedBody).toBe(false);
			expect("toBlock" in capturedBody).toBe(false);
		}
	});
});
