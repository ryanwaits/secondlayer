import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { BaseClient, resolveApiKey } from "../base.ts";
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
	doRequest<T>(
		method: string,
		path: string,
		body?: unknown,
		opts?: { signal?: AbortSignal },
	) {
		return this.request<T>(method, path, body, opts);
	}

	authHeader() {
		return BaseClient.authHeaders(this.apiKey).Authorization;
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

	describe("request budget", () => {
		test("a request that never responds rejects with a retryable timeout error", async () => {
			globalThis.fetch = (() =>
				new Promise<Response>(() => {})) as unknown as typeof fetch;
			const slow = new TestClient({ baseUrl: BASE_URL, requestTimeoutMs: 10 });
			await expect(slow.doRequest("GET", "/hang")).rejects.toMatchObject({
				name: "ApiError",
				code: "REQUEST_TIMEOUT",
				retryable: true,
				status: 0,
			});
		});

		test("a body read that stalls past the budget times out too", async () => {
			globalThis.fetch = (() =>
				Promise.resolve({
					ok: true,
					status: 200,
					headers: new Headers(),
					json: () => new Promise(() => {}),
					text: () => new Promise(() => {}),
				} as Response)) as unknown as typeof fetch;
			const slow = new TestClient({ baseUrl: BASE_URL, requestTimeoutMs: 10 });
			await expect(slow.doRequest("GET", "/slow-body")).rejects.toMatchObject({
				code: "REQUEST_TIMEOUT",
			});
		});

		test("the caller's signal reaches fetch and an abort rejects with its reason", async () => {
			let seen: AbortSignal | null | undefined;
			globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
				seen = init?.signal;
				return new Promise<Response>(() => {});
			}) as unknown as typeof fetch;
			const controller = new AbortController();
			const pending = client.doRequest("GET", "/hang", undefined, {
				signal: controller.signal,
			});
			setTimeout(() => controller.abort(), 5);
			await expect(pending).rejects.toMatchObject({ name: "AbortError" });
			expect(seen).toBeInstanceOf(AbortSignal);
		});

		test("requestTimeoutMs 0 disables the budget", async () => {
			globalThis.fetch = (() =>
				new Promise<Response>((resolve) =>
					setTimeout(() => resolve(Response.json({ ok: true })), 20),
				)) as unknown as typeof fetch;
			const patient = new TestClient({
				baseUrl: BASE_URL,
				requestTimeoutMs: 0,
			});
			await expect(patient.doRequest("GET", "/slow")).resolves.toEqual({
				ok: true,
			});
		});
	});

	describe("fetchImpl", () => {
		test("an injected fetchImpl is used instead of the global", async () => {
			const seen: Array<string | URL | Request> = [];
			const injected: typeof fetch = ((input: string | URL | Request) => {
				seen.push(input);
				return Promise.resolve(Response.json({ via: "injected" }));
			}) as typeof fetch;
			// Poison the global so any fallthrough fails the test loudly.
			globalThis.fetch = (() => {
				throw new Error("global fetch must not be called");
			}) as unknown as typeof fetch;

			const c = new TestClient({ baseUrl: BASE_URL, fetchImpl: injected });
			const result = await c.doRequest<{ via: string }>("GET", "/test");

			expect(result).toEqual({ via: "injected" });
			expect(seen).toEqual([`${BASE_URL}/test`]);
		});

		test("defaults to the global fetch when not provided", async () => {
			globalThis.fetch = mockFetch({ ok: true, status: 200, body: { g: 1 } });
			const c = new TestClient({ baseUrl: BASE_URL });
			await expect(c.doRequest("GET", "/test")).resolves.toEqual({ g: 1 });
		});
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
				// shortMessage is the clean line; message appends the docs pointer.
				expect((err as ApiError).shortMessage).toBe(
					"API key invalid or expired.",
				);
				expect((err as ApiError).message).toContain("Docs: ");
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
				expect((err as ApiError).shortMessage).toBe(
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

	describe("resolveApiKey", () => {
		const originalLegacy = process.env.SL_API_KEY;
		const originalToken = process.env.INSTANCE_TOKEN;

		beforeEach(() => {
			delete process.env.SL_API_KEY;
			delete process.env.INSTANCE_TOKEN;
		});

		afterEach(() => {
			if (originalLegacy === undefined) delete process.env.SL_API_KEY;
			else process.env.SL_API_KEY = originalLegacy;
			if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
			else process.env.INSTANCE_TOKEN = originalToken;
		});

		test("falls back to INSTANCE_TOKEN when no apiKey is passed", () => {
			process.env.INSTANCE_TOKEN = "sk-sl_instance_token";
			expect(resolveApiKey()).toBe("sk-sl_instance_token");
			expect(new TestClient().authHeader()).toBe("Bearer sk-sl_instance_token");
		});

		test("falls back to SL_API_KEY when no apiKey is passed", () => {
			process.env.SL_API_KEY = "sk-sl_from_env";
			expect(resolveApiKey()).toBe("sk-sl_from_env");
			expect(new TestClient().authHeader()).toBe("Bearer sk-sl_from_env");
		});

		test("INSTANCE_TOKEN wins when both env vars are set", () => {
			process.env.INSTANCE_TOKEN = "sk-sl_instance_token";
			process.env.SL_API_KEY = "sk-sl_legacy_alias";
			expect(resolveApiKey()).toBe("sk-sl_instance_token");
		});

		test("an empty INSTANCE_TOKEN falls through to SL_API_KEY", () => {
			process.env.INSTANCE_TOKEN = "";
			process.env.SL_API_KEY = "sk-sl_from_env";
			expect(resolveApiKey()).toBe("sk-sl_from_env");
		});

		test("an explicit apiKey wins over both env vars", () => {
			process.env.INSTANCE_TOKEN = "sk-sl_instance_token";
			process.env.SL_API_KEY = "sk-sl_from_env";
			expect(resolveApiKey("sk-sl_explicit")).toBe("sk-sl_explicit");
		});

		test("an explicit empty string opts back into keyless", () => {
			process.env.INSTANCE_TOKEN = "sk-sl_instance_token";
			expect(resolveApiKey("")).toBe("");
			expect(new TestClient({ apiKey: "" }).authHeader()).toBeUndefined();
		});

		test("resolves to undefined when both env vars are unset or empty", () => {
			expect(resolveApiKey()).toBeUndefined();
			process.env.INSTANCE_TOKEN = "";
			process.env.SL_API_KEY = "";
			expect(resolveApiKey()).toBeUndefined();
		});

		test("warns once when both env vars are set to different values", () => {
			const original = console.warn;
			const warnings: string[] = [];
			console.warn = (...args: unknown[]) => {
				warnings.push(args.join(" "));
			};
			try {
				process.env.INSTANCE_TOKEN = "sk-sl_conflict_token";
				process.env.SL_API_KEY = "sk-sl_conflict_legacy";
				resolveApiKey();
				resolveApiKey();
			} finally {
				console.warn = original;
			}
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("INSTANCE_TOKEN");
			expect(warnings[0]).toContain("SL_API_KEY");
		});

		test("stays quiet when both env vars agree", () => {
			const original = console.warn;
			const warnings: string[] = [];
			console.warn = (...args: unknown[]) => {
				warnings.push(args.join(" "));
			};
			try {
				process.env.INSTANCE_TOKEN = "sk-sl_same_value";
				process.env.SL_API_KEY = "sk-sl_same_value";
				expect(resolveApiKey()).toBe("sk-sl_same_value");
			} finally {
				console.warn = original;
			}
			expect(warnings).toHaveLength(0);
		});
	});

	describe("error envelope on every failure status", () => {
		test("a 401 keeps the server's message and code", async () => {
			globalThis.fetch = mockFetch({
				ok: false,
				status: 401,
				body: { error: "Token revoked. Rotate it.", code: "TOKEN_REVOKED" },
			});
			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect((err as ApiError).status).toBe(401);
				expect((err as ApiError).shortMessage).toBe(
					"Token revoked. Rotate it.",
				);
				expect((err as ApiError).code).toBe("TOKEN_REVOKED");
				expect((err as ApiError).body).toEqual({
					error: "Token revoked. Rotate it.",
					code: "TOKEN_REVOKED",
				});
			}
		});

		test("a 429 carries retryAfterSeconds as a number for the retry loop", async () => {
			globalThis.fetch = mockFetch({
				ok: false,
				status: 429,
				body: { error: "slow down", code: "RATE_LIMITED" },
				headers: { "Retry-After": "12" },
			});
			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect((err as ApiError).retryAfterSeconds).toBe(12);
				expect((err as ApiError).retryable).toBe(true);
				expect((err as ApiError).code).toBe("RATE_LIMITED");
				expect((err as ApiError).shortMessage).toBe("slow down");
			}
		});

		test("a 503 surfaces the server's reason, code, and Retry-After", async () => {
			globalThis.fetch = mockFetch({
				ok: false,
				status: 503,
				body: { error: "indexer behind tip", code: "INDEX_NOT_READY" },
				headers: { "Retry-After": "30" },
			});
			try {
				await client.doRequest("GET", "/test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect((err as ApiError).status).toBe(503);
				expect((err as ApiError).shortMessage).toBe("indexer behind tip");
				expect((err as ApiError).code).toBe("INDEX_NOT_READY");
				expect((err as ApiError).retryAfterSeconds).toBe(30);
				expect((err as ApiError).retryable).toBe(true);
			}
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
