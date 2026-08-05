import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function authedRequest(cookie: string) {
	return new Request("http://localhost/api/admin/accounts", {
		headers: { cookie },
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe("GET /api/admin/accounts", () => {
	// This is the fail-open gap this plan closes: the route used to check only
	// that a session cookie was present, forwarding every authenticated caller
	// to upstream and trusting upstream's requireAdmin() to reject them.
	test("403s a non-admin session without forwarding to the upstream admin endpoint", async () => {
		let adminEndpointHit = false;
		globalThis.fetch = (async (url: string) => {
			const u = String(url);
			if (u.endsWith("/api/accounts/me")) {
				return jsonResponse({ id: "acct_1", email: "not-admin@example.com" });
			}
			if (u.endsWith("/api/admin/accounts")) {
				adminEndpointHit = true;
				return jsonResponse({ accounts: [] });
			}
			throw new Error(`unexpected fetch: ${u}`);
		}) as typeof fetch;

		const { GET } = await import("./route");
		const res = await GET(authedRequest("sl_session=non-admin-token"));

		expect(res.status).toBe(403);
		expect(adminEndpointHit).toBe(false);
	});

	test("forwards to the upstream admin endpoint for an allowlisted admin session", async () => {
		globalThis.fetch = (async (url: string) => {
			const u = String(url);
			if (u.endsWith("/api/accounts/me")) {
				return jsonResponse({
					id: "acct_admin",
					email: "ryan.waits@gmail.com",
				});
			}
			if (u.endsWith("/api/admin/accounts")) {
				return jsonResponse({ accounts: [{ id: "acct_1" }] });
			}
			throw new Error(`unexpected fetch: ${u}`);
		}) as typeof fetch;

		const { GET } = await import("./route");
		const res = await GET(authedRequest("sl_session=admin-token"));
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.accounts).toEqual([{ id: "acct_1" }]);
	});
});
