import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function req(cookie = "sl_session=tok"): Request {
	return new Request("http://localhost/api/cli/device/NCQQ-ZGWX/approve", {
		method: "POST",
		headers: {
			origin: "http://localhost",
			host: "localhost",
			"content-type": "application/json",
			...(cookie ? { cookie } : {}),
		},
		body: "{}",
	});
}

const params = { params: Promise.resolve({ code: "NCQQ-ZGWX" }) };

describe("CLI approve route", () => {
	test("approves with an empty body, as the approval page sends it", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(String(url));
			return new Response(JSON.stringify({ status: "approved" }), {
				status: 200,
			});
		}) as typeof fetch;
		const { POST } = await import("./route");
		const res = await POST(req(), params);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "approved" });
		expect(
			urls.some((u) => u.endsWith("/api/cli/device/NCQQ-ZGWX/approve")),
		).toBe(true);
	});

	test("a Sentinel approval is one upstream call: the API links in the same transaction", async () => {
		const calls: { url: string; method?: string }[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), method: init?.method });
			return new Response(JSON.stringify({ status: "approved" }), {
				status: 200,
			});
		}) as typeof fetch;
		const { POST } = await import("./route");
		const res = await POST(req(), params);
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(1);
		expect(calls[0].url.endsWith("/api/cli/device/NCQQ-ZGWX/approve")).toBe(
			true,
		);
		expect(calls[0].method).toBe("POST");
		expect(calls.some((c) => c.url.includes("/internal/sentinel"))).toBe(false);
	});

	test("an upstream failure is passed through, not reported as approved", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: "Internal error" }), {
				status: 500,
			})) as unknown as typeof fetch;
		const { POST } = await import("./route");
		const res = await POST(req(), params);
		expect(res.status).toBe(500);
		expect(await res.json()).not.toEqual({ status: "approved" });
	});

	test("no session cookie is 401 and calls nothing", async () => {
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(String(url));
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const { POST } = await import("./route");
		const res = await POST(req(""), params);
		expect(res.status).toBe(401);
		expect(urls).toEqual([]);
	});
});
