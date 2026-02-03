import { test, expect, describe, beforeEach, mock } from "bun:test";
import { StreamsClient } from "./client.ts";
import { ApiError } from "./errors.ts";

const BASE_URL = "http://localhost:3800";
const API_KEY = "test-key-123";

function mockFetch(response: Partial<Response> & { ok: boolean; status: number; body?: unknown }) {
  return mock(() =>
    Promise.resolve({
      ok: response.ok,
      status: response.status,
      headers: new Headers(response.headers),
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? "")),
    } as Response)
  );
}

describe("StreamsClient", () => {
  let client: StreamsClient;

  beforeEach(() => {
    client = new StreamsClient({ baseUrl: BASE_URL, apiKey: API_KEY });
  });

  test("instantiates without throwing", () => {
    expect(client).toBeInstanceOf(StreamsClient);
  });

  test("strips trailing slashes from baseUrl", () => {
    const c = new StreamsClient({ baseUrl: "http://localhost:3800///", apiKey: API_KEY });
    expect(c).toBeInstanceOf(StreamsClient);
  });

  describe("request handling", () => {
    test("successful request returns parsed JSON", async () => {
      const data = { streams: [], total: 0 };
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: data });

      const result = await client.listStreams();
      expect(result).toEqual(data);
    });

    test("401 throws ApiError with generic message", async () => {
      globalThis.fetch = mockFetch({ ok: false, status: 401, body: "" });

      try {
        await client.listStreams();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(401);
        expect((err as ApiError).message).toBe("API key invalid or expired.");
        expect((err as ApiError).message).not.toContain("streams auth");
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
        await client.listStreams();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toContain("30 seconds");
      }
    });

    test("429 without retry-after", async () => {
      globalThis.fetch = mockFetch({ ok: false, status: 429, body: "" });

      try {
        await client.listStreams();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect((err as ApiError).message).toBe("Rate limited. Try again later.");
      }
    });

    test("5xx throws server error", async () => {
      globalThis.fetch = mockFetch({ ok: false, status: 502, body: "" });

      try {
        await client.listStreams();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(502);
        expect((err as ApiError).message).toContain("Server error");
      }
    });

    test("network failure throws connection error", async () => {
      globalThis.fetch = mock(() => Promise.reject(new TypeError("fetch failed")));

      try {
        await client.listStreams();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(0);
        expect((err as ApiError).message).toContain("Cannot reach API");
      }
    });

    test("204 returns undefined", async () => {
      globalThis.fetch = mockFetch({ ok: true, status: 204, body: undefined });

      const result = await client.deleteStream("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(result).toBeUndefined();
    });
  });

  describe("resolveStreamId", () => {
    test("full UUID passthrough", async () => {
      const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const result = await client.resolveStreamId(uuid);
      expect(result).toBe(uuid);
    });

    test("partial match resolves", async () => {
      const streams = [
        { id: "abc12345-bbbb-cccc-dddd-eeeeeeeeeeee", name: "test" },
      ];
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: { streams, total: 1 } });

      const result = await client.resolveStreamId("abc1");
      expect(result).toBe(streams[0].id);
    });

    test("no match throws 404", async () => {
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: { streams: [], total: 0 } });

      try {
        await client.resolveStreamId("xyz");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
      }
    });

    test("ambiguous match throws 400", async () => {
      const streams = [
        { id: "abc12345-1111-cccc-dddd-eeeeeeeeeeee", name: "a" },
        { id: "abc12345-2222-cccc-dddd-eeeeeeeeeeee", name: "b" },
      ];
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: { streams, total: 2 } });

      try {
        await client.resolveStreamId("abc1");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(400);
        expect((err as ApiError).message).toContain("Multiple streams");
      }
    });
  });

  describe("authHeaders", () => {
    test("includes Bearer when apiKey present", () => {
      const headers = StreamsClient.authHeaders("my-key");
      expect(headers["Authorization"]).toBe("Bearer my-key");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    test("omits Authorization when no apiKey", () => {
      const headers = StreamsClient.authHeaders();
      expect(headers["Authorization"]).toBeUndefined();
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });
});
