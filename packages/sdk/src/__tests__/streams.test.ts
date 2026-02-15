import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { Streams } from "../streams/client.ts";
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

describe("Streams", () => {
  let streams: Streams;

  beforeEach(() => {
    streams = new Streams({ baseUrl: BASE_URL, apiKey: API_KEY });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("resolveStreamId", () => {
    test("full UUID passthrough", async () => {
      const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      const result = await streams.resolveStreamId(uuid);
      expect(result).toBe(uuid);
    });

    test("partial match resolves", async () => {
      const list = [
        { id: "abc12345-bbbb-cccc-dddd-eeeeeeeeeeee", name: "test" },
      ];
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: { streams: list, total: 1 } });

      const result = await streams.resolveStreamId("abc1");
      expect(result).toBe(list[0].id);
    });

    test("no match throws 404", async () => {
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: { streams: [], total: 0 } });

      try {
        await streams.resolveStreamId("xyz");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
      }
    });

    test("ambiguous match throws 400", async () => {
      const list = [
        { id: "abc12345-1111-cccc-dddd-eeeeeeeeeeee", name: "a" },
        { id: "abc12345-2222-cccc-dddd-eeeeeeeeeeee", name: "b" },
      ];
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: { streams: list, total: 2 } });

      try {
        await streams.resolveStreamId("abc1");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(400);
        expect((err as ApiError).message).toContain("Multiple streams");
      }
    });
  });

  describe("CRUD", () => {
    test("list returns streams", async () => {
      const data = { streams: [], total: 0 };
      globalThis.fetch = mockFetch({ ok: true, status: 200, body: data });

      const result = await streams.list();
      expect(result).toEqual(data);
    });

    test("delete with full UUID", async () => {
      globalThis.fetch = mockFetch({ ok: true, status: 204, body: undefined });

      const result = await streams.delete("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(result).toBeUndefined();
    });
  });
});
