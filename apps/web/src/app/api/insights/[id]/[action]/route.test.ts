import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const UUID = "0b9c2f6e-1d4a-4c3b-8e7f-5a6d7c8b9e01";

function req(method: string, cookie = "sl_session=tok"): Request {
	return new Request("http://localhost/api/insights/x/dismiss", {
		method,
		headers: cookie ? { cookie } : {},
	});
}

function ctx(id: string, action: string) {
	return { params: Promise.resolve({ id, action }) };
}

function stubFetch(status = 200): { url: string; method?: string }[] {
	const calls: { url: string; method?: string }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), method: init?.method });
		return new Response(JSON.stringify({ ok: true }), { status });
	}) as typeof fetch;
	return calls;
}

describe("insight action route", () => {
	test("no session is 401 and calls nothing", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		const res = await POST(req("POST", ""), ctx(`t:${UUID}`, "dismiss"));
		expect(res.status).toBe(401);
		expect(calls).toEqual([]);
	});

	test("t: ids go to the stack api", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		const res = await POST(req("POST"), ctx(`t:${UUID}`, "dismiss"));
		expect(res.status).toBe(200);
		expect(calls[0]?.url).toEndWith(`/api/insights/${UUID}/dismiss`);
		expect(calls[0]?.method).toBe("POST");
	});

	test("a: ids go to the account api", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		await POST(req("POST"), ctx(`a:${UUID}`, "expected"));
		expect(calls[0]?.url).toEndWith(`/api/accounts/insights/${UUID}/expected`);
	});

	test("DELETE expected undoes it", async () => {
		const calls = stubFetch();
		const { DELETE } = await import("./route");
		const res = await DELETE(req("DELETE"), ctx(`t:${UUID}`, "expected"));
		expect(res.status).toBe(200);
		expect(calls[0]?.method).toBe("DELETE");
	});

	test("an unknown prefix is 400", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		const res = await POST(req("POST"), ctx(`x:${UUID}`, "dismiss"));
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	test("an unprefixed id is 400", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		const res = await POST(req("POST"), ctx(UUID, "dismiss"));
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	test("a malformed raw id is 400", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		const res = await POST(req("POST"), ctx("t:../../keys", "dismiss"));
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	test("an unknown action, or DELETE dismiss, is 400", async () => {
		const calls = stubFetch();
		const { POST, DELETE } = await import("./route");
		expect((await POST(req("POST"), ctx(`t:${UUID}`, "purge"))).status).toBe(
			400,
		);
		expect(
			(await DELETE(req("DELETE"), ctx(`t:${UUID}`, "dismiss"))).status,
		).toBe(400);
		expect(calls).toEqual([]);
	});

	test("an upstream 404 passes through", async () => {
		stubFetch(404);
		const { POST } = await import("./route");
		const res = await POST(req("POST"), ctx(`t:${UUID}`, "dismiss"));
		expect(res.status).toBe(404);
	});
});
