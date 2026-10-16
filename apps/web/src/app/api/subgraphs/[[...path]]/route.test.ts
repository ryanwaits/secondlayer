import { afterEach, describe, expect, test } from "bun:test";
import { upstreamAgent } from "@/lib/upstream-agent";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function req(path = "", cookie: string | null = "sl_session=tok"): Request {
	const headers: Record<string, string> = {};
	if (cookie) headers.cookie = cookie;
	return new Request(`http://localhost/api/subgraphs${path}`, { headers });
}

function ctx(path?: string[]) {
	return { params: Promise.resolve({ path }) };
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init);
	}) as typeof fetch;
	return calls;
}

const ok = () => new Response("{}", { status: 200 });

describe("subgraphs dashboard proxy", () => {
	test("no session cookie → 401, no fetch", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		const res = await GET(req("", null), ctx([]));
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	test("only GET is exported", async () => {
		const route = (await import("./route")) as Record<string, unknown>;
		for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
			expect(route[method]).toBeUndefined();
		}
		expect(typeof route.GET).toBe("function");
	});

	test("a segment with a slash, dot or space → 400, no fetch", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		for (const bad of ["..", "a.b", "a b", "a%2Fb"]) {
			const res = await GET(req(), ctx([bad]));
			expect(res.status).toBe(400);
		}
		expect(calls).toHaveLength(0);
	});

	test("an unlisted path shape → 405, no fetch", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		for (const path of [
			["a", "b", "c", "d", "e"],
			["x", "reindex"],
			["x", "rows"],
			["x", "rows", "t", "delete"],
			["x", "source"],
		]) {
			const res = await GET(req(), ctx(path));
			expect(res.status).toBe(405);
			expect(((await res.json()) as { error: string }).error).toBe(
				"Not available from the dashboard",
			);
		}
		expect(calls).toHaveLength(0);
	});

	test("list and detail map to the control-plane routes with the bearer", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(req(), ctx([]));
		await GET(req(), ctx(["x"]));
		expect(calls[0]?.url.endsWith("/api/subgraphs")).toBe(true);
		expect(calls[1]?.url.endsWith("/api/subgraphs/x")).toBe(true);
		expect(
			(calls[0]?.init?.headers as Record<string, string>).Authorization,
		).toBe("Bearer tok");
	});

	test("health forwards its query string", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(req("/x/health?hours=24"), ctx(["x", "health"]));
		expect(calls[0]?.url.endsWith("/api/subgraphs/x/health?hours=24")).toBe(
			true,
		);
	});

	test("errors, gaps and schema.json map through", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(req(), ctx(["x", "errors"]));
		await GET(req(), ctx(["x", "gaps"]));
		await GET(req(), ctx(["x", "schema.json"]));
		expect(calls.map((c) => c.url.split("localhost:3800")[1] ?? c.url)).toEqual(
			[
				expect.stringContaining("/api/subgraphs/x/errors"),
				expect.stringContaining("/api/subgraphs/x/gaps"),
				expect.stringContaining("/api/subgraphs/x/schema.json"),
			],
		);
	});

	test("rows go to /v1 with the whole row query", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(
			req("/x/rows/t?_sort=amount&_order=desc&kind=burn"),
			ctx(["x", "rows", "t"]),
		);
		expect(
			calls[0]?.url.endsWith(
				"/v1/subgraphs/x/t?_sort=amount&_order=desc&kind=burn",
			),
		).toBe(true);
	});

	test("filter operators and cursors pass; keys with other characters drop", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(
			req("/x/rows/t?amount.gte=5&cursor=abc&a%5Bb%5D=1"),
			ctx(["x", "rows", "t"]),
		);
		expect(
			calls[0]?.url.endsWith("/v1/subgraphs/x/t?amount.gte=5&cursor=abc"),
		).toBe(true);
	});

	test("count maps to /v1 count", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(req(), ctx(["x", "rows", "t", "count"]));
		expect(calls[0]?.url.endsWith("/v1/subgraphs/x/t/count")).toBe(true);
	});

	test("stream passes the body through as text/event-stream", async () => {
		const calls = stubFetch(
			() =>
				new Response("id: 1\ndata: {}\n\n", {
					status: 200,
					headers: { "content-type": "text/plain" },
				}),
		);
		const { GET } = await import("./route");
		const res = await GET(
			req("/x/rows/t/stream?kind=burn"),
			ctx(["x", "rows", "t", "stream"]),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
		expect(await res.text()).toBe("id: 1\ndata: {}\n\n");
		expect(calls[0]?.url.endsWith("/v1/subgraphs/x/t/stream?kind=burn")).toBe(
			true,
		);
		expect(calls[0]?.init?.signal).toBeDefined();
	});

	test("the stream forwards since with the filters", async () => {
		const calls = stubFetch(() => new Response("", { status: 200 }));
		const { GET } = await import("./route");
		await GET(
			req("/x/rows/t/stream?kind=burn&since=9218411"),
			ctx(["x", "rows", "t", "stream"]),
		);
		expect(
			calls[0]?.url.endsWith(
				"/v1/subgraphs/x/t/stream?kind=burn&since=9218411",
			),
		).toBe(true);
	});

	test("a failed stream returns the upstream JSON error, not an event stream", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ error: "nope" }), {
					status: 404,
					headers: { "content-type": "application/json" },
				}),
		);
		const { GET } = await import("./route");
		const res = await GET(req(), ctx(["x", "rows", "t", "stream"]));
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type")).toContain("application/json");
	});

	test("a 503 keeps Retry-After", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ error: "starting" }), {
					status: 503,
					headers: { "Retry-After": "5" },
				}),
		);
		const { GET } = await import("./route");
		const res = await GET(req(), ctx([]));
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("5");
	});

	test("an unreachable upstream → 502", async () => {
		globalThis.fetch = (async (_url: string) => {
			throw new Error("down");
		}) as unknown as typeof fetch;
		const { GET } = await import("./route");
		const res = await GET(req(), ctx([]));
		expect(res.status).toBe(502);
	});

	test("forwards upstream through the shared keep-alive agent", async () => {
		const calls = stubFetch(ok);
		const { GET } = await import("./route");
		await GET(req(), ctx([]));
		const init = calls[0]?.init as
			| (RequestInit & { dispatcher?: unknown })
			| undefined;
		expect(init?.dispatcher).toBe(upstreamAgent);
	});

	test("reports upstream time in Server-Timing", async () => {
		const _calls = stubFetch(ok);
		const { GET } = await import("./route");
		const res = await GET(req(), ctx([]));
		expect(res.headers.get("Server-Timing")).toMatch(
			/^upstream;dur=\d+(\.\d)?$/,
		);
	});
});
