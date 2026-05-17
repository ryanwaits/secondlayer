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

		test("serializes bigint in body to string instead of failing", async () => {
			// Regression: BigInt in request body used to surface as "Cannot
			// reach API" because JSON.stringify(bigint) threw inside the
			// fetch try-block and was caught as a network error.
			const calls: RequestInit[] = [];
			globalThis.fetch = mock((_url: unknown, init?: RequestInit) => {
				if (init) calls.push(init);
				return Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => Promise.resolve({ ok: true }),
					text: () => Promise.resolve(""),
				} as Response);
			}) as unknown as typeof fetch;

			await client.doRequest("POST", "/test", {
				sources: { t: { type: "stx_transfer", minAmount: 1_000_000n } },
			});

			expect(calls.length).toBe(1);
			const sent = JSON.parse(String(calls[0]?.body ?? "{}"));
			expect(sent.sources.t.minAmount).toBe("1000000");
		});

		test("non-serializable body surfaces a body error, not a network error", async () => {
			globalThis.fetch = mock(() => {
				throw new Error("fetch should not be called");
			}) as unknown as typeof fetch;

			const circular: Record<string, unknown> = {};
			circular.self = circular;

			try {
				await client.doRequest("POST", "/test", circular);
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ApiError);
				expect((err as ApiError).message).toContain(
					"Failed to serialize request body",
				);
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
});
