import { afterEach, describe, expect, test } from "bun:test";
import {
	PERF_TEST_SBTC_ROWS,
	PERF_TEST_SBTC_SOURCE,
	exampleHealth,
	perfTestSbtcDetail,
} from "@/components/account/subgraphs/subgraph.fixtures";
import {
	activityFor,
	attempt,
	detail,
	summary,
} from "@/components/account/webhooks/webhook.fixtures";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { readInsights } from "@/lib/server/insights-read";
import { upstreamAgent } from "@/lib/upstream-agent";
import {
	readApi,
	subgraphDetailReads,
	subgraphsListReads,
	webhookDetailReads,
	webhooksListReads,
} from "./dashboard-reads";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

type Call = { path: string; init: RequestInit & { dispatcher?: unknown } };

/** Answers each call from `routes` (longest matching path prefix wins) and
 *  records what was asked. */
function stubApi(routes: Record<string, () => Response>): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		const path = String(url).replace(/^https?:\/\/[^/]+/, "");
		calls.push({ path, init });
		const key = Object.keys(routes)
			.filter((route) => path.startsWith(route))
			.sort((a, b) => b.length - a.length)[0];
		return key ? routes[key]?.() : new Response("{}", { status: 404 });
	}) as unknown as typeof fetch;
	return calls;
}

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});

describe("readApi", () => {
	test("the session cookie becomes the bearer, on the keep-alive agent, uncached", async () => {
		const calls = stubApi({ "/api/webhooks": () => json({ data: [] }) });
		await readApi("tok_123", "/api/webhooks");
		expect(calls).toHaveLength(1);
		const { init } = calls[0] as Call;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer tok_123",
		);
		expect(init.dispatcher).toBe(upstreamAgent);
		expect(init.cache).toBe("no-store");
	});

	test("statuses map to the kinds the browser side uses", async () => {
		stubApi({
			"/a": () => json({ error: "asleep" }, 503),
			"/b": () => json({ error: "x" }, 503, { "Retry-After": "9" }),
			"/c": () => json({}, 402),
			"/d": () => json({}, 404),
		});
		expect(await readApi("t", "/a")).toEqual({ kind: "asleep" });
		expect(await readApi("t", "/b")).toEqual({
			kind: "starting",
			retryAfter: 9,
		});
		expect(await readApi("t", "/c")).toEqual({ kind: "no_credits" });
		expect(await readApi("t", "/d")).toEqual({ kind: "not_found" });
	});

	test("a dropped connection is an error result, never a throw", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNRESET");
		}) as unknown as typeof fetch;
		expect(await readApi("t", "/x")).toEqual({
			kind: "error",
			message: "Couldn't reach the API",
		});
	});
});

describe("webhooksListReads", () => {
	test("reads the list and the hourly summary", async () => {
		const calls = stubApi({
			"/api/webhooks/activity": () => json({ hours: ["h"], webhooks: [] }),
			"/api/webhooks": () => json({ data: [summary()] }),
		});
		const res = await webhooksListReads("t");
		expect(calls.map((c) => c.path).sort()).toEqual([
			"/api/webhooks",
			"/api/webhooks/activity",
		]);
		expect(res.list.kind === "ok" && res.list.data).toHaveLength(1);
		expect(res.summary.kind === "ok" && res.summary.data.hours).toEqual(["h"]);
	});

	test("an account with no stack yet reads as no webhooks", async () => {
		stubApi({});
		expect(await webhooksListReads("t")).toEqual({
			list: { kind: "ok", data: [] },
			summary: { kind: "ok", data: { hours: [], webhooks: [] } },
		});
	});
});

describe("webhookDetailReads", () => {
	const routes = {
		"/api/webhooks/wh_1/deliveries": () =>
			json({ data: [{ ...attempt(), blockTime: undefined }] }),
		"/api/webhooks/wh_1/activity": () => json(activityFor(3)),
		"/api/webhooks/wh_1": () => json(detail({ id: "wh_1", name: "pox watch" })),
	};

	test("reads the webhook, its deliveries and activity, and renders the code frames", async () => {
		const calls = stubApi(routes);
		const res = await webhookDetailReads("t", "wh_1");
		expect(calls.map((c) => c.path).sort()).toEqual([
			"/api/webhooks/wh_1",
			"/api/webhooks/wh_1/activity",
			"/api/webhooks/wh_1/deliveries",
		]);
		expect(res.webhook.kind).toBe("ok");
		// A tenant on an older image can omit blockTime: normalized to null.
		expect(
			res.deliveries.kind === "ok" && res.deliveries.data[0]?.blockTime,
		).toBe(null);
		expect(res.listens).toHaveLength(1);
		expect(res.listens?.[0]?.html).toContain("stxTransfer");
	});

	test("an asleep stack carries through, with no frames rendered", async () => {
		stubApi({ "/api/webhooks/wh_1": () => json({ error: "asleep" }, 503) });
		const res = await webhookDetailReads("t", "wh_1");
		expect(res.webhook).toEqual({ kind: "asleep" });
		expect(res.listens).toBeNull();
	});

	test("an id that is not a path segment is not found and reads nothing", async () => {
		const calls = stubApi(routes);
		const res = await webhookDetailReads("t", "../keys");
		expect(res.webhook).toEqual({ kind: "not_found" });
		expect(calls).toHaveLength(0);
	});
});

describe("subgraphs reads", () => {
	test("the list asks for a week of health, and a 404 reads as no subgraphs", async () => {
		const calls = stubApi({});
		const res = await subgraphsListReads("t");
		expect(calls[0]?.path).toBe("/api/subgraphs?health=168");
		expect(res).toEqual({ kind: "ok", data: [] });
	});

	test("the detail reads health, errors, source and the newest rows of the biggest tables", async () => {
		const calls = stubApi({
			"/api/subgraphs/perf-test-sbtc/health": () => json(exampleHealth()),
			"/api/subgraphs/perf-test-sbtc/errors": () => json({ data: [] }),
			"/api/subgraphs/perf-test-sbtc/source": () =>
				json({
					name: "perf-test-sbtc",
					version: "1.0.0",
					sourceCode: PERF_TEST_SBTC_SOURCE,
					readOnly: false,
					updatedAt: "2026-11-03T19:50:00Z",
					handlerCode: "compiled bundle that must not reach the page",
				}),
			"/api/subgraphs/perf-test-sbtc": () => json(perfTestSbtcDetail),
			"/v1/subgraphs/perf-test-sbtc/": () =>
				json({ rows: Object.values(PERF_TEST_SBTC_ROWS)[0] ?? [] }),
		});
		const res = await subgraphDetailReads("t", "perf-test-sbtc");
		const paths = calls.map((c) => c.path);
		expect(paths).toContain("/api/subgraphs/perf-test-sbtc/health?hours=168");
		expect(paths).toContain("/api/subgraphs/perf-test-sbtc/errors?limit=20");
		expect(
			paths.filter((p) =>
				p.includes("_sort=_block_height&_order=desc&_limit=10"),
			).length,
		).toBeGreaterThan(0);
		expect(res.source.kind === "ok" && res.source.data).not.toHaveProperty(
			"handlerCode",
		);
		expect(res.rows?.failed).toBe(false);
		expect(res.rows?.rows.length).toBeGreaterThan(0);
		expect(res.tableBlocks?.length).toBeGreaterThan(0);
	});

	test("a detail that did not load reads no rows and renders no frames", async () => {
		stubApi({ "/api/subgraphs/gone": () => json({}, 404) });
		const res = await subgraphDetailReads("t", "gone");
		expect(res.detail).toEqual({ kind: "not_found" });
		expect(res.rows).toBeNull();
		expect(res.tableBlocks).toBeNull();
	});

	test("every table read failing is a failed Recent rows, not an empty one", async () => {
		stubApi({
			"/api/subgraphs/perf-test-sbtc": () => json(perfTestSbtcDetail),
			"/v1/subgraphs/": () => json({ error: "boom" }, 500),
		});
		const res = await subgraphDetailReads("t", "perf-test-sbtc");
		expect(res.rows).toEqual({ rows: [], failed: true });
	});
});

describe("readInsights", () => {
	const some = FIXTURE_INSIGHTS.slice(0, 2).map(({ id, ...rest }) => ({
		...rest,
		id,
	}));

	test("merges the stack's and the account's insights, ids prefixed, ranked", async () => {
		const calls = stubApi({
			"/api/accounts/insights": () => json({ data: [some[1]] }),
			"/api/insights": () => json({ data: [some[0]] }),
		});
		const res = await readInsights("t");
		expect(calls.map((c) => c.path).sort()).toEqual([
			"/api/accounts/insights",
			"/api/insights",
		]);
		expect(res?.map((i) => i.id).sort()).toEqual(
			[`t:${some[0]?.id}`, `a:${some[1]?.id}`].sort(),
		);
	});

	test("one side failing still returns the other", async () => {
		stubApi({
			"/api/accounts/insights": () => json({}, 503),
			"/api/insights": () => json({ data: [some[0]] }),
		});
		expect(await readInsights("t")).toHaveLength(1);
	});

	test("both sides failing is null, so the page falls back to the browser fetch", async () => {
		stubApi({
			"/api/accounts/insights": () => json({}, 503),
			"/api/insights": () => json({}, 500),
		});
		expect(await readInsights("t")).toBeNull();
	});
});
