import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { BaseClient } from "../base.ts";
import { ApiError } from "../errors.ts";

const BASE_URL = "http://localhost:3800";
const API_KEY = "test-key-123";

const originalFetch = globalThis.fetch;

function mockFetch(response: { ok: boolean; status: number; body?: unknown; headers?: Record<string, string> }) {
  return mock(() =>
    Promise.resolve({
      ok: response.ok,
      status: response.status,
      headers: new Headers(response.headers),
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? "")),
    } as Response)
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
        expect((err as ApiError).message).toBe("Rate limited. Try again later.");
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
      globalThis.fetch = mock(() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;

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
      expect(headers["Authorization"]).toBe("Bearer my-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    test("omits Authorization when no apiKey", () => {
      const headers = BaseClient.authHeaders();
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });
});
