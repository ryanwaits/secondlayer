import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
const KEY = `sk-sl_${"1a2b3c4d".repeat(4)}`;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const SITE = {
	origin: "https://www.secondlayer.tools",
	host: "www.secondlayer.tools",
};
const SIGNED_IN = { ...SITE, cookie: "sl_session=ss-sl_abc" };
const context = { params: Promise.resolve({ id: "key-1" }) };

function req(headers: Record<string, string>): Request {
	return new Request("https://www.secondlayer.tools/api/keys/key-1/rotate", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: "{}",
	});
}

function stubApi(
	status = 201,
	body: unknown = { key: KEY, name: "prod" },
	headers: Record<string, string> = {},
): { calls: { url: string; init?: RequestInit }[] } {
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return new Response(JSON.stringify(body), { status, headers });
	}) as typeof fetch;
	return { calls };
}

describe("POST /api/keys/[id]/rotate", () => {
	test("a signed-in same-site request gets a no-store key and the API sees only the session", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(req(SIGNED_IN), context);
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.json()).toEqual({ key: KEY, name: "prod" });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toEndWith("/api/keys/key-1/rotate");
		expect(
			(calls[0]?.init?.headers as Record<string, string>).Authorization,
		).toBe("Bearer ss-sl_abc");
	});

	test("a cross-site request is refused before the API is called", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(
			req({ ...SIGNED_IN, origin: "https://evil.example" }),
			context,
		);
		expect(res.status).toBe(403);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(calls).toHaveLength(0);
	});

	test("an Authorization header is refused: the session cookie is the only credential", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(
			req({ ...SITE, authorization: "Bearer sk-sl_anything" }),
			context,
		);
		expect(res.status).toBe(400);
		expect(calls).toHaveLength(0);
	});

	test("no session cookie is a 401 with no API call", async () => {
		const { calls } = stubApi();
		const { POST } = await import("./route");
		const res = await POST(req(SITE), context);
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	test("a rate limit comes through as 429 with its retry delay", async () => {
		stubApi(429, { error: "Slow down" }, { "retry-after": "30" });
		const { POST } = await import("./route");
		const res = await POST(req(SIGNED_IN), context);
		expect(res.status).toBe(429);
		expect(((await res.json()) as { retryAfter?: number }).retryAfter).toBe(30);
	});

	test("a conflict comes through as 409 with the API's message", async () => {
		stubApi(409, { error: "Key already revoked" });
		const { POST } = await import("./route");
		const res = await POST(req(SIGNED_IN), context);
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toBe(
			"Key already revoked",
		);
	});
});
