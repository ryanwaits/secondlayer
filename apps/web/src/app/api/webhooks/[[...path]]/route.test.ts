import { afterEach, describe, expect, test } from "bun:test";
import { upstreamAgent } from "@/lib/upstream-agent";

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

	function patchReq(body: unknown): Request {
		return new Request("http://localhost/api/webhooks/wh_1", {
			method: "PATCH",
			headers: { cookie: "sl_session=tok", "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("PATCH :id with only a name is forwarded with that body and a JSON content type", async () => {
		const { calls } = stubFetch(
			() => new Response(JSON.stringify({ id: "wh_1" }), { status: 200 }),
		);
		const { PATCH } = await import("./route");
		const res = await PATCH(
			patchReq({ name: " vault-events " }),
			ctx(["wh_1"]),
		);
		expect(res.status).toBe(200);
		expect(calls[0]?.init?.method).toBe("PATCH");
		expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "vault-events" }));
		expect(new Headers(calls[0]?.init?.headers).get("Content-Type")).toBe(
			"application/json",
		);
	});

	test("PATCH with any key besides name → 405, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { PATCH } = await import("./route");
		const res = await PATCH(
			patchReq({ name: "vault-events", url: "https://hooks.example.dev" }),
			ctx(["wh_1"]),
		);
		expect(res.status).toBe(405);
		expect(calls.length).toBe(0);
	});

	test("PATCH with an empty or overlong name → 405, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { PATCH } = await import("./route");
		for (const name of ["   ", "x".repeat(129), 7]) {
			const res = await PATCH(patchReq({ name }), ctx(["wh_1"]));
			expect(res.status).toBe(405);
		}
		expect(calls.length).toBe(0);
	});

	test("PATCH on the list path → 405, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { PATCH } = await import("./route");
		const res = await PATCH(patchReq({ name: "vault-events" }), ctx([]));
		expect(res.status).toBe(405);
		expect(calls.length).toBe(0);
	});

	test("query string: from/to/days are forwarded, unknown params are dropped", async () => {
		const { calls } = stubFetch(
			() => new Response(JSON.stringify({ data: [] }), { status: 200 }),
		);
		const { GET } = await import("./route");
		const request = new Request(
			"http://localhost/api/webhooks/wh_1/deliveries?from=2026-10-08T16:00:00Z&to=2026-10-08T17:00:00Z&days=30&evil=1",
			{ headers: { cookie: "sl_session=tok" } },
		);
		await GET(request, ctx(["wh_1", "deliveries"]));
		const url = new URL(calls[0]?.url ?? "");
		expect(url.searchParams.get("from")).toBe("2026-10-08T16:00:00Z");
		expect(url.searchParams.get("to")).toBe("2026-10-08T17:00:00Z");
		expect(url.searchParams.get("days")).toBe("30");
		expect(url.searchParams.has("evil")).toBe(false);
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

	for (const path of [["wh_1", "activity"]]) {
		test(`GET ${path.slice(1).join("/")} (the detail page's graphs) is forwarded`, async () => {
			const { calls } = stubFetch(
				() => new Response(JSON.stringify({}), { status: 200 }),
			);
			const { GET } = await import("./route");
			const res = await GET(req({ cookie: "sl_session=tok" }), ctx(path));
			expect(res.status).toBe(200);
			expect(calls[0]?.url.endsWith(`/api/webhooks/${path.join("/")}`)).toBe(
				true,
			);
		});
	}

	test("GET :id/deliveries/:deliveryId is refused → 405, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(
			req({ cookie: "sl_session=tok" }),
			ctx(["wh_1", "deliveries", "d1"]),
		);
		expect(res.status).toBe(405);
		expect(calls.length).toBe(0);
	});

	test("GET :id/deliveries/:deliveryId/anything deeper is refused → 405", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(
			req({ cookie: "sl_session=tok" }),
			ctx(["wh_1", "deliveries", "d1", "x"]),
		);
		expect(res.status).toBe(405);
		expect(calls.length).toBe(0);
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

	test("DELETE :id is not available → 405, no fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const mod = await import("./route");
		expect((mod as Record<string, unknown>).DELETE).toBeUndefined();
		expect(calls.length).toBe(0);
	});

	for (const path of [
		["wh_1", "test"],
		["wh_1", "rotate-secret"],
		["wh_1", "dead", "ob_1", "requeue"],
	]) {
		test(`POST ${path.slice(1).join("/")} is not available → 405, no fetch`, async () => {
			const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
			const { POST } = await import("./route");
			const res = await POST(
				req({ method: "POST", cookie: "sl_session=tok" }),
				ctx(path),
			);
			expect(res.status).toBe(405);
			expect(calls.length).toBe(0);
		});
	}

	for (const action of ["pause", "resume"]) {
		test(`POST :id/${action} is allowed`, async () => {
			const { calls } = stubFetch(
				() => new Response(JSON.stringify({ id: "wh_1" }), { status: 200 }),
			);
			const { POST } = await import("./route");
			const res = await POST(
				req({ method: "POST", cookie: "sl_session=tok" }),
				ctx(["wh_1", action]),
			);
			expect(res.status).toBe(200);
			expect(calls[0]?.url.endsWith(`/api/webhooks/wh_1/${action}`)).toBe(true);
		});
	}

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

	test("forwards upstream through the shared keep-alive agent", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		await GET(req({ cookie: "sl_session=tok" }), ctx([]));
		const init = calls[0]?.init as
			| (RequestInit & { dispatcher?: unknown })
			| undefined;
		expect(init?.dispatcher).toBe(upstreamAgent);
	});

	test("reports upstream time in Server-Timing", async () => {
		const _ = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(req({ cookie: "sl_session=tok" }), ctx([]));
		expect(res.headers.get("Server-Timing")).toMatch(
			/^upstream;dur=\d+(\.\d)?$/,
		);
	});
});
