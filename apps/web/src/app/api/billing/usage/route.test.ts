import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function req(opts: { cookie?: string; month?: string }): Request {
	const headers: Record<string, string> = {};
	if (opts.cookie) headers.cookie = opts.cookie;
	const url = new URL("http://localhost/api/billing/usage");
	if (opts.month !== undefined) url.searchParams.set("month", opts.month);
	return new Request(url, { headers });
}

function stubFetch(handler: (url: string) => Response): {
	calls: string[];
} {
	const calls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		calls.push(String(url));
		return handler(String(url));
	}) as typeof fetch;
	return { calls };
}

describe("GET /api/billing/usage", () => {
	test("no session cookie → 401, no upstream fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(req({}));
		expect(res.status).toBe(401);
		expect((await res.json()) as { error: string }).toEqual({
			error: "Sign in first",
		});
		expect(calls.length).toBe(0);
	});

	test("a malformed month → 400, no upstream fetch", async () => {
		const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(req({ cookie: "sl_session=tok", month: "2026-13" }));
		expect(res.status).toBe(400);
		expect(calls.length).toBe(0);
	});

	test("no month → defaults to the current UTC month upstream", async () => {
		const { calls } = stubFetch(
			() =>
				new Response(JSON.stringify({ month: "x", usage: [] }), {
					status: 200,
				}),
		);
		const { GET } = await import("./route");
		const res = await GET(req({ cookie: "sl_session=tok" }));
		expect(res.status).toBe(200);
		const now = new Date();
		const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
		expect(calls[0]).toContain(`month=${expected}`);
	});

	test("a valid month passes through the upstream body unchanged", async () => {
		const body = {
			month: "2026-09",
			usage: [{ unit: "rows.delivered", quantity: "42", usdMicros: "0" }],
		};
		stubFetch(() => new Response(JSON.stringify(body), { status: 200 }));
		const { GET } = await import("./route");
		const res = await GET(req({ cookie: "sl_session=tok", month: "2026-09" }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(body);
	});

	test("the API status passes through on error", async () => {
		stubFetch(
			() => new Response(JSON.stringify({ error: "nope" }), { status: 403 }),
		);
		const { GET } = await import("./route");
		const res = await GET(req({ cookie: "sl_session=tok", month: "2026-09" }));
		expect(res.status).toBe(403);
		expect((await res.json()) as { error: string }).toEqual({ error: "nope" });
	});
});
