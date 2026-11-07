import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const req = (cookie = "sl_session=tok") =>
	new Request("http://localhost/api/auth/me", {
		headers: cookie ? { cookie } : {},
	});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status });

describe("auth me route", () => {
	test("no session cookie is signed out without calling the API", async () => {
		let called = false;
		globalThis.fetch = (async (_url: string) => {
			called = true;
			return json({});
		}) as typeof fetch;
		const { GET } = await import("./route");
		const res = await GET(req(""));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ account: null });
		expect(called).toBe(false);
	});

	test("a valid session returns the account", async () => {
		globalThis.fetch = (async (_url: string) =>
			json({ id: "a1", email: "a@b.co" })) as typeof fetch;
		const { GET } = await import("./route");
		const res = await GET(req());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			account: { id: "a1", email: "a@b.co" },
		});
	});

	test("an expired session is signed out and its cookie is cleared", async () => {
		globalThis.fetch = (async (_url: string) =>
			json({ error: "unauthorized" }, 401)) as typeof fetch;
		const { GET } = await import("./route");
		const res = await GET(req());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ account: null });
		expect(res.headers.get("set-cookie")).toContain("sl_session=;");
	});

	test("an API that is down is unreachable, never signed out, and keeps the cookie", async () => {
		globalThis.fetch = (async (_url: string) =>
			json({ error: "bad gateway" }, 502)) as typeof fetch;
		const { GET } = await import("./route");
		const res = await GET(req());
		expect(res.status).toBe(503);
		expect(res.headers.get("set-cookie")).toBeNull();
	});

	test("a network error is unreachable too", async () => {
		globalThis.fetch = ((_url: string) =>
			Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
		const { GET } = await import("./route");
		const res = await GET(req());
		expect(res.status).toBe(503);
	});
});
