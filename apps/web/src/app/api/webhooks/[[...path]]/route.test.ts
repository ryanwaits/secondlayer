import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function req(opts: {
	method?: string;
	cookie?: string;
}): Request {
	const headers: Record<string, string> = {};
	if (opts.cookie) headers.cookie = opts.cookie;
	return new Request("http://localhost/api/webhooks", {
		method: opts.method ?? "GET",
		headers,
	});
}

function ctx(path?: string[]) {
	return { params: Promise.resolve({ path }) };
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
	calls: { url: string; init?: RequestInit }[];
} {
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init);
	}) as typeof fetch;
	return { calls };
}

describe("webhooks dashboard proxy", () => {
	test("no session cookie → 401, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(req({}), ctx([]));
		expect(res.status).toBe(401);
		expect(calls.length).toBe(0);
	});

	test("POST '' (create) → 405, not available from the dashboard, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { POST } = await import("./route");
		const res = await POST(
			req({ method: "POST", cookie: "sl_session=tok" }),
			ctx([]),
		);
		expect(res.status).toBe(405);
		expect(((await res.json()) as { error: string }).error).toBe(
			"Not available from the dashboard",
		);
		expect(calls.length).toBe(0);
	});

	test("PATCH is not exported — updates never go through the dashboard", async () => {
		const mod = await import("./route");
		expect((mod as Record<string, unknown>).PATCH).toBeUndefined();
	});

	test("GET :id/deliveries forwards the right upstream URL with the session as a Bearer token", async () => {
		const { calls } = stubFetch(
			() => new Response(JSON.stringify({ data: [] }), { status: 200 }),
		);
		const { GET } = await import("./route");
		const res = await GET(
			req({ cookie: "sl_session=session-tok" }),
			ctx(["wh_1", "deliveries"]),
		);
		expect(res.status).toBe(200);
		expect(calls.length).toBe(1);
		expect(calls[0]?.url.endsWith("/api/webhooks/wh_1/deliveries")).toBe(true);
		const headers = new Headers(calls[0]?.init?.headers);
		expect(headers.get("Authorization")).toBe("Bearer session-tok");
	});

	test("a 503 upstream passes through the status and Retry-After header", async () => {
		stubFetch(
			() =>
				new Response(
					JSON.stringify({ error: "provisioning", retry_after: 30 }),
					{
						status: 503,
						headers: { "Retry-After": "30" },
					},
				),
		);
		const { GET } = await import("./route");
		const res = await GET(req({ cookie: "sl_session=tok" }), ctx([]));
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("30");
	});

	test("a bad path segment → 400, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(
			req({ cookie: "sl_session=tok" }),
			ctx(["wh_1", ".."]),
		);
		expect(res.status).toBe(400);
		expect(calls.length).toBe(0);
	});

	test("DELETE :id is allowed", async () => {
		const { calls } = stubFetch(
			() => new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		const { DELETE } = await import("./route");
		const res = await DELETE(
			req({ method: "DELETE", cookie: "sl_session=tok" }),
			ctx(["wh_1"]),
		);
		expect(res.status).toBe(200);
		expect(calls[0]?.url.endsWith("/api/webhooks/wh_1")).toBe(true);
	});

	test("POST :id/dead/:outboxId/requeue is allowed", async () => {
		const { calls } = stubFetch(
			() => new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		const { POST } = await import("./route");
		const res = await POST(
			req({ method: "POST", cookie: "sl_session=tok" }),
			ctx(["wh_1", "dead", "ob_1", "requeue"]),
		);
		expect(res.status).toBe(200);
		expect(calls[0]?.url.endsWith("/api/webhooks/wh_1/dead/ob_1/requeue")).toBe(
			true,
		);
	});

	test("POST :id/replay is not in the allowlist → 405, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { POST } = await import("./route");
		const res = await POST(
			req({ method: "POST", cookie: "sl_session=tok" }),
			ctx(["wh_1", "replay"]),
		);
		expect(res.status).toBe(405);
		expect(calls.length).toBe(0);
	});
});
