import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { BaseClient } from "../base.ts";
import { ApiError } from "../errors.ts";

const BASE_URL = "http://localhost:3800";
const API_KEY = "test-key-123";

const originalFetch = globalThis.fetch;

function mockFetch(response: {
	ok: boolean;
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
}) {
	return mock(() =>
		Promise.resolve({
			ok: response.ok,
			status: response.status,
			headers: new Headers(response.headers),
			json: () => Promise.resolve(response.body),
			text: () =>
				Promise.resolve(
					typeof response.body === "string"
						? response.body
						: JSON.stringify(response.body ?? ""),
				),
		} as Response),
	) as unknown as typeof fetch;
}

/** Minimal concrete subclass for testing BaseClient. */
class TestClient extends BaseClient {
	doRequest<T>(method: string, path: string, body?: unknown) {
		return this.request<T>(method, path, body);
	}
	doRequestAtTenant<T>(method: string, path: string, body?: unknown) {
		return this.requestAtTenant<T>(method, path, body);
	}
}

type FetchCall = { url: string; init?: RequestInit };

/**
 * Multi-response fetch mock — pop responses by URL prefix; record every call
 * for sequencing assertions in tenant-resolution tests.
 */
function recordingMockFetch(
	responses: Array<{
		match: (url: string) => boolean;
		ok: boolean;
		status: number;
		body: unknown;
	}>,
): { fetch: typeof fetch; calls: FetchCall[] } {
	const calls: FetchCall[] = [];
	const handler = ((input: unknown, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		const r = responses.find((r) => r.match(url));
		if (!r) {
			return Promise.reject(new Error(`No mock for ${url}`));
		}
		return Promise.resolve({
			ok: r.ok,
			status: r.status,
			headers: new Headers(),
			json: () => Promise.resolve(r.body),
			text: () =>
				Promise.resolve(
					typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? ""),
				),
		} as Response);
	}) as unknown as typeof fetch;
	return { fetch: handler, calls };
}

describe("BaseClient", () => {
	let client: TestClient;

	beforeEach(() => {
		client = new TestClient({ baseUrl: BASE_URL, apiKey: API_KEY });
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("strips trailing slashes from baseUrl", () => {
		const c = new TestClient({ baseUrl: "http://localhost:3800///" });
		expect(c).toBeInstanceOf(BaseClient);
	});

	test("defaults baseUrl when not provided", () => {
		const c = new TestClient();
		expect(c).toBeInstanceOf(BaseClient);
	});

	describe("request handling", () => {
		test("successful request returns parsed JSON", async () => {
			const data = { ok: true };
			globalThis.fetch = mockFetch({ ok: true, status: 200, body: data });

			const result = await client.doRequest("GET", "/test");
			expect(result).toEqual(data);
		});

		test("401 throws ApiError", async () => {
			globalThis.fetch = mockFetch({ ok: false, status: 401, body: "" });

			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).status).toBe(401);
				expect((err as ApiError).message).toBe("API key invalid or expired.");
			}
		});

		test("429 includes retry-after", async () => {
			globalThis.fetch = mockFetch({
				ok: false,
				status: 429,
				body: "",
				headers: { "Retry-After": "30" },
			});

			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).message).toContain("30 seconds");
			}
		});

		test("429 without retry-after", async () => {
			globalThis.fetch = mockFetch({ ok: false, status: 429, body: "" });

			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect((err as ApiError).message).toBe(
					"Rate limited. Try again later.",
				);
			}
		});

		test("5xx throws server error", async () => {
			globalThis.fetch = mockFetch({ ok: false, status: 502, body: "" });

			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).status).toBe(502);
				expect((err as ApiError).message).toContain("Server error");
			}
		});

		test("network failure throws connection error", async () => {
			globalThis.fetch = mock(() =>
				Promise.reject(new TypeError("fetch failed")),
			) as unknown as typeof fetch;

			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).status).toBe(0);
				expect((err as ApiError).message).toContain("Cannot reach API");
			}
		});

		test("204 returns undefined", async () => {
			globalThis.fetch = mockFetch({ ok: true, status: 204, body: undefined });

			const result = await client.doRequest("DELETE", "/test");
			expect(result).toBeUndefined();
		});
	});

	describe("authHeaders", () => {
		test("includes Bearer when apiKey present", () => {
			const headers = BaseClient.authHeaders("my-key");
			expect(headers.Authorization).toBe("Bearer my-key");
			expect(headers["Content-Type"]).toBe("application/json");
		});

		test("omits Authorization when no apiKey", () => {
			const headers = BaseClient.authHeaders();
			expect(headers.Authorization).toBeUndefined();
			expect(headers["Content-Type"]).toBe("application/json");
		});
	});

	describe("ApiError envelope extraction", () => {
		test("populates ApiError.code from {error, code} JSON body", async () => {
			globalThis.fetch = mockFetch({
				ok: false,
				status: 400,
				body: { error: "bad cursor", code: "VALIDATION_ERROR" },
			});
			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).code).toBe("VALIDATION_ERROR");
				expect((err as ApiError).message).toBe("bad cursor");
				expect((err as ApiError).body).toEqual({
					error: "bad cursor",
					code: "VALIDATION_ERROR",
				});
			}
		});

		test("code is undefined when body is plain text (no JSON envelope)", async () => {
			globalThis.fetch = mockFetch({
				ok: false,
				status: 404,
				body: "404 Not Found",
			});
			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect((err as ApiError).code).toBeUndefined();
				expect((err as ApiError).message).toBe("404 Not Found");
			}
		});
	});

	describe("tenant session auto-resolution (mint-ephemeral)", () => {
		const TENANT_URL = "https://myslug-abc.api.secondlayer.tools";
		const TENANT_JWT = "eyJhbGc.eyJyb2xlIjoic2VydmljZSJ9.signature";

		function freshEphemeralBody(ttlMs = 5 * 60_000) {
			return {
				apiUrl: TENANT_URL,
				serviceKey: TENANT_JWT,
				expiresAt: new Date(Date.now() + ttlMs).toISOString(),
			};
		}

		test("requestAtTenant mints ephemeral and uses returned apiUrl + serviceKey", async () => {
			const { fetch: fetchMock, calls } = recordingMockFetch([
				{
					match: (u) => u.endsWith("/api/tenants/me/keys/mint-ephemeral"),
					ok: true,
					status: 200,
					body: freshEphemeralBody(),
				},
				{
					match: (u) => u.startsWith(TENANT_URL),
					ok: true,
					status: 200,
					body: { data: [] },
				},
			]);
			globalThis.fetch = fetchMock;

			const result = await client.doRequestAtTenant<{ data: unknown[] }>(
				"GET",
				"/api/subgraphs",
			);
			expect(result).toEqual({ data: [] });
			expect(calls.length).toBe(2);
			expect(calls[0]?.url).toBe(
				`${BASE_URL}/api/tenants/me/keys/mint-ephemeral`,
			);
			expect(calls[1]?.url).toBe(`${TENANT_URL}/api/subgraphs`);
			const tenantAuth = (calls[1]?.init?.headers as Record<string, string>)
				?.Authorization;
			expect(tenantAuth).toBe(`Bearer ${TENANT_JWT}`);
		});

		test("subsequent tenant calls reuse the cached ephemeral session", async () => {
			const { fetch: fetchMock, calls } = recordingMockFetch([
				{
					match: (u) => u.endsWith("/api/tenants/me/keys/mint-ephemeral"),
					ok: true,
					status: 200,
					body: freshEphemeralBody(),
				},
				{
					match: (u) => u.startsWith(TENANT_URL),
					ok: true,
					status: 200,
					body: { data: [] },
				},
			]);
			globalThis.fetch = fetchMock;

			await client.doRequestAtTenant("GET", "/api/subgraphs");
			await client.doRequestAtTenant("GET", "/api/subscriptions");

			const mintCalls = calls.filter((c) =>
				c.url.endsWith("/api/tenants/me/keys/mint-ephemeral"),
			);
			expect(mintCalls.length).toBe(1);
			expect(calls.length).toBe(3);
		});

		test("concurrent first calls share a single mint round-trip", async () => {
			const { fetch: fetchMock, calls } = recordingMockFetch([
				{
					match: (u) => u.endsWith("/api/tenants/me/keys/mint-ephemeral"),
					ok: true,
					status: 200,
					body: freshEphemeralBody(),
				},
				{
					match: (u) => u.startsWith(TENANT_URL),
					ok: true,
					status: 200,
					body: { data: [] },
				},
			]);
			globalThis.fetch = fetchMock;

			await Promise.all([
				client.doRequestAtTenant("GET", "/api/subgraphs"),
				client.doRequestAtTenant("GET", "/api/subscriptions"),
				client.doRequestAtTenant("GET", "/api/subgraphs/foo"),
			]);

			const mintCalls = calls.filter((c) =>
				c.url.endsWith("/api/tenants/me/keys/mint-ephemeral"),
			);
			expect(mintCalls.length).toBe(1);
		});

		test("session near expiry triggers a refresh", async () => {
			let mintCount = 0;
			const fetchMock = ((input: unknown) => {
				const url = String(input);
				if (url.endsWith("/api/tenants/me/keys/mint-ephemeral")) {
					mintCount += 1;
					// First mint: only 5s of life remaining (well inside the
					// 30s refresh buffer).
					const ttlMs = mintCount === 1 ? 5_000 : 5 * 60_000;
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () =>
							Promise.resolve({
								apiUrl: TENANT_URL,
								serviceKey: `${TENANT_JWT}-v${mintCount}`,
								expiresAt: new Date(Date.now() + ttlMs).toISOString(),
							}),
						text: () => Promise.resolve(""),
					} as Response);
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => Promise.resolve({ data: [] }),
					text: () => Promise.resolve(""),
				} as Response);
			}) as unknown as typeof fetch;
			globalThis.fetch = fetchMock;

			await client.doRequestAtTenant("GET", "/api/subgraphs"); // mint #1, near-expiry
			await client.doRequestAtTenant("GET", "/api/subscriptions"); // should re-mint
			expect(mintCount).toBe(2);
		});

		test("tenantBaseUrl override skips minting entirely", async () => {
			const c2 = new TestClient({
				baseUrl: BASE_URL,
				apiKey: API_KEY,
				tenantBaseUrl: TENANT_URL,
			});
			const { fetch: fetchMock, calls } = recordingMockFetch([
				{
					match: (u) => u.startsWith(TENANT_URL),
					ok: true,
					status: 200,
					body: { data: [] },
				},
			]);
			globalThis.fetch = fetchMock;

			await c2.doRequestAtTenant("GET", "/api/subgraphs");
			expect(calls.length).toBe(1);
			expect(calls[0]?.url).toBe(`${TENANT_URL}/api/subgraphs`);
			// Override falls back to the platform apiKey as the Bearer.
			const auth = (calls[0]?.init?.headers as Record<string, string>)
				?.Authorization;
			expect(auth).toBe(`Bearer ${API_KEY}`);
		});

		test("mint response without serviceKey throws NO_TENANT_TOKEN", async () => {
			globalThis.fetch = mockFetch({
				ok: true,
				status: 200,
				body: {
					apiUrl: TENANT_URL,
					serviceKey: "",
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				},
			});

			try {
				await client.doRequestAtTenant("GET", "/api/subgraphs");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).code).toBe("NO_TENANT_TOKEN");
			}
		});

		test("mint response without apiUrl throws NO_TENANT", async () => {
			globalThis.fetch = mockFetch({
				ok: true,
				status: 200,
				body: {
					apiUrl: "",
					serviceKey: TENANT_JWT,
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				},
			});

			try {
				await client.doRequestAtTenant("GET", "/api/subgraphs");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).code).toBe("NO_TENANT");
			}
		});

		test("failed mint is NOT cached — next call retries", async () => {
			let mintCount = 0;
			const fetchMock = ((input: unknown) => {
				const url = String(input);
				if (url.endsWith("/api/tenants/me/keys/mint-ephemeral")) {
					mintCount += 1;
					if (mintCount === 1) {
						return Promise.resolve({
							ok: false,
							status: 401,
							headers: new Headers(),
							json: () => Promise.resolve(""),
							text: () => Promise.resolve(""),
						} as Response);
					}
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers(),
						json: () => Promise.resolve(freshEphemeralBody()),
						text: () => Promise.resolve(""),
					} as Response);
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => Promise.resolve({ data: [] }),
					text: () => Promise.resolve(""),
				} as Response);
			}) as unknown as typeof fetch;
			globalThis.fetch = fetchMock;

			await expect(
				client.doRequestAtTenant("GET", "/api/subgraphs"),
			).rejects.toBeInstanceOf(ApiError);

			const result = await client.doRequestAtTenant<{ data: unknown[] }>(
				"GET",
				"/api/subgraphs",
			);
			expect(result).toEqual({ data: [] });
			expect(mintCount).toBe(2);
		});

		test("plain request() does not trigger tenant resolution", async () => {
			const { fetch: fetchMock, calls } = recordingMockFetch([
				{
					match: (u) => u.startsWith(BASE_URL),
					ok: true,
					status: 200,
					body: { ok: true },
				},
			]);
			globalThis.fetch = fetchMock;

			await client.doRequest("GET", "/v1/streams/tip");
			expect(calls.length).toBe(1);
			expect(
				calls.find((c) =>
					c.url.endsWith("/api/tenants/me/keys/mint-ephemeral"),
				),
			).toBeUndefined();
		});
	});
});
