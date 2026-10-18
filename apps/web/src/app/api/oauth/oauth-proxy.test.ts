import { afterEach, describe, expect, test } from "bun:test";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

type Call = { url: string; method?: string; auth?: string | null };

function capture(
	status = 200,
	body: unknown = { redirect: "http://127.0.0.1:1/cb?code=c" },
) {
	const calls: Call[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({
			url: String(url),
			method: init?.method,
			auth: new Headers(init?.headers).get("authorization"),
		});
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return calls;
}

function req(
	method: string,
	path: string,
	{ cookie = "sl_session=ss-sl_tok", origin = "http://localhost" } = {},
): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			host: "localhost",
			...(origin ? { origin } : {}),
			...(cookie ? { cookie } : {}),
			...(method === "POST" ? { "content-type": "application/json" } : {}),
		},
		...(method === "POST" ? { body: "{}" } : {}),
	});
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("OAuth consent proxies", () => {
	test("approve forwards the session to the API and returns its redirect", async () => {
		const calls = capture();
		const { POST } = await import("./requests/[id]/approve/route");
		const res = await POST(
			req("POST", "/api/oauth/requests/oar_x/approve"),
			params("oar_x"),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			redirect: "http://127.0.0.1:1/cb?code=c",
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].url.endsWith("/api/oauth/requests/oar_x/approve")).toBe(
			true,
		);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].auth).toBe("Bearer ss-sl_tok");
	});

	test("a cross-site approve, deny or revoke is 403 and calls nothing", async () => {
		const calls = capture();
		const approve = (await import("./requests/[id]/approve/route")).POST;
		const deny = (await import("./requests/[id]/deny/route")).POST;
		const revoke = (await import("./grants/[id]/route")).DELETE;
		for (const origin of ["https://evil.example", ""]) {
			expect(
				(
					await approve(
						req("POST", "/api/oauth/requests/oar_x/approve", { origin }),
						params("oar_x"),
					)
				).status,
			).toBe(403);
			expect(
				(
					await deny(
						req("POST", "/api/oauth/requests/oar_x/deny", { origin }),
						params("oar_x"),
					)
				).status,
			).toBe(403);
			expect(
				(
					await revoke(
						req("DELETE", "/api/oauth/grants/g", { origin }),
						params("g"),
					)
				).status,
			).toBe(403);
		}
		expect(calls).toHaveLength(0);
	});

	test("no session cookie is 401 and calls nothing", async () => {
		const calls = capture();
		const { GET } = await import("./grants/route");
		const res = await GET(req("GET", "/api/oauth/grants", { cookie: "" }));
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	test("an upstream refusal is passed through", async () => {
		capture(403, { error: "Not a browser session" });
		const { GET } = await import("./requests/[id]/route");
		const res = await GET(
			req("GET", "/api/oauth/requests/oar_x"),
			params("oar_x"),
		);
		expect(res.status).toBe(403);
	});

	test("an id that would leave its path segment is refused before any call", async () => {
		const calls = capture();
		const { GET } = await import("./requests/[id]/route");
		const res = await GET(req("GET", "/api/oauth/requests/x"), params(".."));
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(calls.some((c) => c.url.includes("/api/oauth/requests/.."))).toBe(
			false,
		);
	});
});
