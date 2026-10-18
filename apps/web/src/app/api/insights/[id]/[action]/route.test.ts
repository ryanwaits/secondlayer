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

function snoozeReq(body: string): Request {
	return new Request("http://localhost/api/insights/x/snooze", {
		method: "POST",
		headers: { cookie: "sl_session=tok", "Content-Type": "application/json" },
		body,
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

	test("an unknown action is 400 on POST and DELETE", async () => {
		const calls = stubFetch();
		const { POST, DELETE } = await import("./route");
		expect((await POST(req("POST"), ctx(`t:${UUID}`, "purge"))).status).toBe(
			400,
		);
		expect(
			(await DELETE(req("DELETE"), ctx(`t:${UUID}`, "purge"))).status,
		).toBe(400);
		expect(calls).toEqual([]);
	});

	test("DELETE dismiss and DELETE snooze are forwarded", async () => {
		const calls = stubFetch();
		const { DELETE } = await import("./route");
		for (const action of ["dismiss", "snooze"]) {
			const res = await DELETE(req("DELETE"), ctx(`t:${UUID}`, action));
			expect(res.status).toBe(200);
		}
		expect(calls.map((c) => c.url.split("/").pop())).toEqual([
			"dismiss",
			"snooze",
		]);
		expect(calls.every((c) => c.method === "DELETE")).toBe(true);
	});

	test("POST snooze forwards the until body", async () => {
		const bodies: string[] = [];
		globalThis.fetch = (async (_url: string, init?: RequestInit) => {
			bodies.push(String(init?.body));
			return new Response("{}", { status: 200 });
		}) as typeof fetch;
		const { POST } = await import("./route");
		const until = "2026-10-19T09:00:00.000Z";
		const res = await POST(
			snoozeReq(JSON.stringify({ until })),
			ctx(`t:${UUID}`, "snooze"),
		);
		expect(res.status).toBe(200);
		expect(JSON.parse(bodies[0] ?? "{}")).toEqual({ until });
	});

	test("POST snooze without until, or with a bad body, is 400", async () => {
		const calls = stubFetch();
		const { POST } = await import("./route");
		for (const raw of [
			JSON.stringify({}),
			JSON.stringify({ until: 5 }),
			"{x",
		]) {
			const res = await POST(snoozeReq(raw), ctx(`t:${UUID}`, "snooze"));
			expect(res.status).toBe(400);
		}
		expect(calls).toEqual([]);
	});

	test("an upstream 404 passes through", async () => {
		stubFetch(404);
		const { POST } = await import("./route");
		const res = await POST(req("POST"), ctx(`t:${UUID}`, "dismiss"));
		expect(res.status).toBe(404);
	});
});
