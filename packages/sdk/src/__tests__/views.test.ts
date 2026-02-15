import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { Views } from "../views/client.ts";

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

describe("Views", () => {
  let views: Views;

  beforeEach(() => {
    views = new Views({ baseUrl: BASE_URL, apiKey: API_KEY });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("queryTable builds correct URL", async () => {
    globalThis.fetch = mockFetch({ ok: true, status: 200, body: [{ id: 1 }] });

    const result = await views.queryTable("my-view", "events", {
      sort: "block_height",
      order: "desc",
      limit: 10,
    });
    expect(result).toEqual([{ id: 1 }]);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/views/my-view/events");
    expect(calledUrl).toContain("_sort=block_height");
    expect(calledUrl).toContain("_order=desc");
    expect(calledUrl).toContain("_limit=10");
  });

  test("queryTableCount builds correct URL", async () => {
    globalThis.fetch = mockFetch({ ok: true, status: 200, body: { count: 42 } });

    const result = await views.queryTableCount("my-view", "events", {
      filters: { sender: "SP123" },
    });
    expect(result).toEqual({ count: 42 });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/views/my-view/events/count");
    expect(calledUrl).toContain("sender=SP123");
  });

  test("queryTable with no params omits query string", async () => {
    globalThis.fetch = mockFetch({ ok: true, status: 200, body: [] });

    await views.queryTable("my-view", "events");

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(`${BASE_URL}/api/views/my-view/events`);
  });

  test("deploy sends POST to /api/views", async () => {
    const deployData = { name: "test-view", query: "SELECT 1" };
    globalThis.fetch = mockFetch({ ok: true, status: 200, body: { name: "test-view", status: "deploying" } });

    await views.deploy(deployData as any);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    const [calledUrl, calledOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${BASE_URL}/api/views`);
    expect(calledOpts.method).toBe("POST");
  });
});
