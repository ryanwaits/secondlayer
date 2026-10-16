import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function verifyRequest() {
	return new Request("http://localhost/api/auth/verify", {
		method: "POST",
		body: JSON.stringify({ token: "magic-link-token" }),
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

const account = {
	id: "acct_1",
	email: "person@example.com",
	displayName: null,
	bio: null,
	avatarUrl: null,
	createdAt: "2026-01-01T00:00:00.000Z",
};

type Call = { url: string; method: string; body?: unknown };

function stubFetch(
	handler: (url: string, method: string, body: unknown) => Response,
): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ url: String(url), method, body });
		return handler(String(url), method, body);
	}) as typeof fetch;
	return calls;
}

describe("POST /api/auth/verify", () => {
	test("verifies and returns the account without minting a key", async () => {
		const calls = stubFetch((url, method) => {
			if (url.endsWith("/api/auth/verify")) {
				return jsonResponse({ sessionToken: "session-abc", account });
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});

		const { POST } = await import("./route");
		const res = await POST(verifyRequest());
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body).toEqual({ account });
		expect(res.headers.get("Set-Cookie")).toContain("sl_session=session-abc");
		expect(calls.map((c) => c.url.split("/api/")[1])).toEqual(["auth/verify"]);
	});
});
