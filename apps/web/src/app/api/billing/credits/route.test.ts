import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string) => Response): string[] {
	const calls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		calls.push(String(url));
		return handler(String(url));
	}) as typeof fetch;
	return calls;
}

function req(cookie?: string): Request {
	return new Request("http://localhost/api/billing/credits", {
		headers: cookie ? { cookie } : {},
	});
}

describe("GET /api/billing/credits", () => {
	test("no session cookie → 401, no upstream fetch", async () => {
		const calls = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(req());
		expect(res.status).toBe(401);
		expect(calls.length).toBe(0);
	});

	test("with a session, forwards upstream and returns the body", async () => {
		const body = {
			credits: [
				{
					occurredAt: "2026-10-09T10:00:00.000Z",
					kind: "grant",
					source: "test",
					usdMicros: "5000000",
				},
			],
		};
		const calls = stubFetch(
			() => new Response(JSON.stringify(body), { status: 200 }),
		);
		const { GET } = await import("./route");
		const res = await GET(req("sl_session=tok"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(body);
		expect(calls[0]).toContain("/api/billing/credits");
	});

	test("the API status passes through on error", async () => {
		stubFetch(
			() => new Response(JSON.stringify({ error: "nope" }), { status: 403 }),
		);
		const { GET } = await import("./route");
		const res = await GET(req("sl_session=tok"));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "nope" });
	});
});
