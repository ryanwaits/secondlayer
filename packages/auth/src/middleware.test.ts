import { test, expect, describe, mock, beforeEach } from "bun:test";
import { Hono } from "hono";
import { requireAuth } from "./middleware.ts";
import { generateApiKey, hashApiKey } from "./keys.ts";

// Mock DB — injected via requireAuth({ getDb }) instead of mock.module
const mockExecuteTakeFirst = mock(() => Promise.resolve(null));
const mockExecute = mock(() => Promise.resolve([]));
const mockDb = {
  selectFrom: () => ({
    selectAll: () => ({
      where: (_col: string, _op: string, _val: string) => ({
        executeTakeFirst: mockExecuteTakeFirst,
      }),
    }),
  }),
  updateTable: () => ({
    set: () => ({
      where: () => ({
        execute: mockExecute,
      }),
    }),
  }),
};

const mockGetDb = () => mockDb as any;

function createApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err.message.includes("revoked")) return c.json({ error: err.message }, 403);
    if ((err as any).code === "AUTHENTICATION_ERROR") return c.json({ error: err.message }, 401);
    if ((err as any).code === "AUTHORIZATION_ERROR") return c.json({ error: err.message }, 403);
    return c.json({ error: err.message }, 500);
  });
  app.use("/*", requireAuth({ getDb: mockGetDb }));
  app.get("/test", (c) => c.json({ ok: true, apiKey: (c as any).get("apiKey") }));
  return app;
}

describe("requireAuth middleware", () => {
  beforeEach(() => {
    mockExecuteTakeFirst.mockReset();
    mockExecute.mockReset();
  });

  test("no key → 401", async () => {
    const app = createApp();
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  test("invalid key → 401", async () => {
    const app = createApp();
    mockExecuteTakeFirst.mockResolvedValue(null);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer sk-sl_0000000000000000000000000000000a" },
    });
    expect(res.status).toBe(401);
  });

  test("revoked key → 403", async () => {
    const app = createApp();
    mockExecuteTakeFirst.mockResolvedValue({
      id: "test-id",
      status: "revoked",
      key_hash: "x",
    } as any);
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer sk-sl_00000000000000000000000000000001" },
    });
    expect(res.status).toBe(403);
  });

  test("valid key → passes with apiKey on context", async () => {
    const { raw } = generateApiKey();
    const keyRecord = {
      id: "test-id",
      status: "active",
      key_hash: hashApiKey(raw),
      rate_limit: 120,
    };
    mockExecuteTakeFirst.mockResolvedValue(keyRecord as any);
    mockExecute.mockResolvedValue([] as any);

    const app = createApp();
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${raw}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.apiKey.id).toBe("test-id");
  });
});
