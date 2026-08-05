import { afterEach, describe, expect, test } from "bun:test";
import { requireAdmin } from "./admin";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function authedRequest(cookie?: string) {
	return new Request("http://localhost/api/admin/accounts", {
		headers: cookie ? { cookie } : {},
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe("requireAdmin", () => {
	test("401s when there is no session cookie at all", async () => {
		const result = await requireAdmin(authedRequest());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.response.status).toBe(401);
	});

	// This is the fail-open gap the guard closes: previously these routes
	// checked only that a session existed, not who it belonged to, and relied
	// on upstream to reject a non-admin caller.
	test("403s a session that resolves to a non-admin account, without letting the caller reach the upstream admin endpoint", async () => {
		globalThis.fetch = (async (url: string) => {
			if (String(url).endsWith("/api/accounts/me")) {
				return jsonResponse({ id: "acct_1", email: "not-admin@example.com" });
			}
			throw new Error(`unexpected fetch: ${url}`);
		}) as typeof fetch;

		const result = await requireAdmin(
			authedRequest("sl_session=non-admin-token"),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.response.status).toBe(403);
	});

	test("403s when the upstream account lookup itself fails", async () => {
		globalThis.fetch = (async (url: string) => {
			if (String(url).endsWith("/api/accounts/me")) {
				return jsonResponse({ error: "invalid session" }, 401);
			}
			throw new Error(`unexpected fetch: ${url}`);
		}) as typeof fetch;

		const result = await requireAdmin(authedRequest("sl_session=bad-token"));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.response.status).toBe(403);
	});

	test("resolves to the session token for an allowlisted admin account", async () => {
		globalThis.fetch = (async (url: string) => {
			if (String(url).endsWith("/api/accounts/me")) {
				return jsonResponse({
					id: "acct_admin",
					email: "ryan.waits@gmail.com",
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		}) as typeof fetch;

		const result = await requireAdmin(authedRequest("sl_session=admin-token"));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.sessionToken).toBe("admin-token");
	});
});
