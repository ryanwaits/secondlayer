import { afterEach, describe, expect, spyOn, test } from "bun:test";

const originalFetch = globalThis.fetch;
const KEY = `sk-sl_${"9f8e7d6c".repeat(4)}`;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function req(headers: Record<string, string>): Request {
	return new Request("https://www.secondlayer.tools/api/keys/docs", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: "{}",
	});
}

const SITE = {
	origin: "https://www.secondlayer.tools",
	host: "www.secondlayer.tools",
};

function stubApi(status = 201): {
	calls: { url: string; init?: RequestInit }[];
} {
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return new Response(
			JSON.stringify(
				status === 201
					? {
							key: KEY,
							prefix: KEY.slice(0, 14),
							expiresAt: "2026-10-15T00:00:00Z",
						}
					: { error: "nope" },
			),
			{ status },
		);
	}) as typeof fetch;
	return { calls };
}

describe("POST /api/keys/docs", () => {
	test("a signed-in same-site request gets a no-store key and the API sees only the session", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(req({ ...SITE, cookie: "sl_session=ss-sl_abc" }));
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(((await res.json()) as { key: string }).key).toBe(KEY);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toEndWith("/api/keys/docs");
		expect(
			(calls[0]?.init?.headers as Record<string, string>).Authorization,
		).toBe("Bearer ss-sl_abc");
	});

	test("a cross-site request is refused before the API is called", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(
			req({
				origin: "https://evil.example",
				host: SITE.host,
				cookie: "sl_session=ss-sl_abc",
			}),
		);
		expect(res.status).toBe(403);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(calls).toHaveLength(0);
	});

	test("a request with no Origin is refused", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(
			req({ host: SITE.host, cookie: "sl_session=ss-sl_abc" }),
		);
		expect(res.status).toBe(403);
		expect(calls).toHaveLength(0);
	});

	test("an Authorization header is refused: the session cookie is the only credential", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(
			req({ ...SITE, authorization: "Bearer sk-sl_anything" }),
		);
		expect(res.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	test("no session cookie is a 401 with no API call", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(req(SITE));
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	test("the daily limit comes through as 429", async () => {
		stubApi(429);
		const { POST } = await import("./route");
		const res = await POST(req({ ...SITE, cookie: "sl_session=ss-sl_abc" }));
		expect(res.status).toBe(429);
	});

	test("the key is never written to the console", async () => {
		stubApi();
		const spies = (["log", "info", "warn", "error", "debug"] as const).map(
			(m) => spyOn(console, m),
		);
		const { POST } = await import("./route");
		await POST(req({ ...SITE, cookie: "sl_session=ss-sl_abc" }));
		for (const spy of spies) {
			expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
			spy.mockRestore();
		}
	});
});
