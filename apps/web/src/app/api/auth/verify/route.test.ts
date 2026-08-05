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
	plan: "free",
	displayName: null,
	bio: null,
	slug: null,
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
	// Regression: /api/keys returns an envelope ({ keys: [...] }), not a bare
	// array. Reading `.length` off the envelope is always undefined, so
	// `undefined === 0` is false and the mint branch never fired for anyone.
	test("mints a Default key when the account has zero keys", async () => {
		const calls = stubFetch((url, method) => {
			if (url.endsWith("/api/auth/verify")) {
				return jsonResponse({ sessionToken: "session-abc", account });
			}
			if (url.endsWith("/api/keys") && method === "POST") {
				return jsonResponse({ key: "sl_live_newkey" });
			}
			if (url.endsWith("/api/keys")) {
				return jsonResponse({ keys: [] });
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});

		const { POST } = await import("./route");
		const res = await POST(verifyRequest());
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.apiKey).toBe("sl_live_newkey");

		const mintCall = calls.find(
			(c) => c.url.endsWith("/api/keys") && c.method === "POST",
		);
		expect(mintCall).toBeDefined();
		expect(mintCall?.body).toEqual({ name: "Default" });
	});

	test("does not mint a key when the account already has one", async () => {
		const calls = stubFetch((url, method) => {
			if (url.endsWith("/api/auth/verify")) {
				return jsonResponse({ sessionToken: "session-abc", account });
			}
			if (url.endsWith("/api/keys")) {
				return jsonResponse({
					keys: [
						{
							id: "key_1",
							prefix: "sl_live",
							name: "Existing",
							status: "active",
							product: "account",
							tier: null,
							createdAt: "2026-01-01T00:00:00.000Z",
							lastUsedAt: null,
						},
					],
				});
			}
			throw new Error(`unexpected fetch: ${method} ${url}`);
		});

		const { POST } = await import("./route");
		const res = await POST(verifyRequest());
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.apiKey).toBeUndefined();

		const mintCall = calls.find(
			(c) => c.url.endsWith("/api/keys") && c.method === "POST",
		);
		expect(mintCall).toBeUndefined();
	});

	test("a mint failure still returns a successful verification", async () => {
		stubFetch((url) => {
			if (url.endsWith("/api/auth/verify")) {
				return jsonResponse({ sessionToken: "session-abc", account });
			}
			if (url.endsWith("/api/keys")) {
				return jsonResponse({ error: "upstream unavailable" }, 500);
			}
			throw new Error(`unexpected fetch: ${url}`);
		});

		const originalConsoleError = console.error;
		let loggedArgs: unknown[] | undefined;
		console.error = (...args: unknown[]) => {
			loggedArgs = args;
		};

		try {
			const { POST } = await import("./route");
			const res = await POST(verifyRequest());
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.account).toEqual(account);
			expect(body.apiKey).toBeUndefined();
			// Non-fatal, but no longer silently swallowed.
			expect(loggedArgs).toBeDefined();
		} finally {
			console.error = originalConsoleError;
		}
	});
});
