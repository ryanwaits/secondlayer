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
