import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, apiRequest, getSessionFromRequest } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(): { calls: string[] } {
	const calls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		calls.push(String(url));
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	}) as typeof fetch;
	return { calls };
}

// Reproduces, at the apiRequest layer, what an empirical run against a live
// Next dev server + mock upstream showed: a caller-controlled dynamic
// segment interpolated unencoded into the path lets the WHATWG URL parser
// `fetch` uses pop preceding segments. `/api/subgraphs/<name>` built with
// name = "..%2Fadmin%2Faccounts" resolved upstream to `/api/admin/accounts`
// — a route this caller's own session token should never reach. That
// traversal is real regardless of `encodeURIComponent`, because
// `encodeURIComponent` does not escape ".". This guards against it
// independently of every call site remembering to sanitize its input.
describe("apiRequest path traversal guard", () => {
	test("rejects a literal .. path segment before it reaches fetch", async () => {
		stubFetch();
		await expect(
			apiRequest("/api/subgraphs/../admin/accounts"),
		).rejects.toThrow(ApiError);
	});

	test("rejects a percent-encoded .. segment (the exact reachable exploit shape)", async () => {
		const { calls } = stubFetch();
		await expect(
			apiRequest("/api/subgraphs/..%2Fadmin%2Faccounts"),
		).rejects.toMatchObject({ status: 400 });
		expect(calls).toHaveLength(0);
	});

	test("rejects a segment that decodes to a smuggled slash", async () => {
		stubFetch();
		await expect(
			apiRequest("/api/subgraphs/%2E%2E%2Fadmin"),
		).rejects.toMatchObject({ status: 400 });
	});

	test("rejects a lone-dot segment", async () => {
		stubFetch();
		await expect(apiRequest("/api/subgraphs/.")).rejects.toMatchObject({
			status: 400,
		});
	});

	test("allows an ordinary encoded segment through to fetch", async () => {
		const { calls } = stubFetch();
		await apiRequest("/api/subgraphs/my-normal-subgraph");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("/api/subgraphs/my-normal-subgraph");
	});
});

describe("getSessionFromRequest", () => {
	const reqWith = (cookie: string) =>
		new Request("http://x", { headers: { cookie } });

	test("reads the session cookie wherever it sits in the header", () => {
		expect(getSessionFromRequest(reqWith("sl_session=abc"))).toBe("abc");
		expect(getSessionFromRequest(reqWith("a=1; sl_session=abc; b=2"))).toBe(
			"abc",
		);
	});

	test("ignores a cookie whose name only ends in sl_session", () => {
		expect(getSessionFromRequest(reqWith("not_sl_session=evil"))).toBeNull();
		expect(
			getSessionFromRequest(reqWith("not_sl_session=evil; sl_session=real")),
		).toBe("real");
	});
});
