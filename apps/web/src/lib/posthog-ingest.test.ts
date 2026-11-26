import { describe, expect, test } from "bun:test";
import {
	ingestRequestHeaders,
	ingestResponseHeaders,
	ingestUpstreamUrl,
} from "./posthog-ingest";

describe("posthog ingest upstream url", () => {
	test("event capture keeps its trailing slash and query", () => {
		expect(ingestUpstreamUrl("/ingest/e/", "?ip=1")).toBe(
			"https://us.i.posthog.com/e/?ip=1",
		);
	});

	test("static assets resolve to the assets host", () => {
		expect(ingestUpstreamUrl("/ingest/static/array.js", "")).toBe(
			"https://us-assets.i.posthog.com/static/array.js",
		);
	});

	test("flags keep trailing slash and version query", () => {
		expect(ingestUpstreamUrl("/ingest/flags/", "?v=2")).toBe(
			"https://us.i.posthog.com/flags/?v=2",
		);
	});

	test("parent traversal is rejected", () => {
		expect(() => ingestUpstreamUrl("/ingest/../x", "")).toThrow();
		expect(() => ingestUpstreamUrl("/ingest/static/../x", "")).toThrow();
	});
});

describe("posthog ingest headers", () => {
	test("only allowlisted request headers are forwarded", () => {
		const out = ingestRequestHeaders(
			new Headers({
				cookie: "sl_session=ss-sl_x",
				authorization: "Bearer y",
				"x-vercel-id": "z",
				"content-type": "text/plain",
				"user-agent": "ua",
				"x-forwarded-for": "1.2.3.4",
			}),
		);
		expect([...out.keys()].sort()).toEqual([
			"content-type",
			"user-agent",
			"x-forwarded-for",
		]);
		expect(out.has("cookie")).toBe(false);
		expect(out.has("authorization")).toBe(false);
		expect(out.has("x-vercel-id")).toBe(false);
	});

	test("upstream cookies and framing headers are dropped from the response", () => {
		const out = ingestResponseHeaders(
			new Headers({
				"set-cookie": "a=b",
				"content-encoding": "gzip",
				"content-length": "3",
				"content-type": "application/json",
			}),
		);
		expect([...out.keys()]).toEqual(["content-type"]);
	});
});
