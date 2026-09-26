import { afterEach, describe, expect, jest, test } from "bun:test";
import type {
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";
import {
	clearWebhooksData,
	poll,
	prefetchDetail,
	refreshDetail,
	refreshList,
	webhooksSnapshot,
} from "./webhooks-store";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	clearWebhooksData();
});

function jsonResponse(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function summary(id: string, name: string): WebhookSummary {
	return {
		id,
		name,
		status: "active",
		kind: "chain",
		subgraphName: null,
		tableName: null,
		format: "standard-webhooks",
		runtime: "node",
		url: "https://example.com/webhook",
		lastDeliveryAt: null,
		lastSuccessAt: null,
		circuitOpenedAt: null,
		circuitFailures: 0,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

function detail(id: string, name: string): WebhookDetail {
	return {
		...summary(id, name),
		filter: {},
		triggers: null,
		authConfig: {},
		maxRetries: 7,
		timeoutMs: 10_000,
		concurrency: 8,
		lastError: null,
		warning: null,
	};
}

const emptyActivity: WebhookActivity = {
	hours: [],
	waiting: 0,
	nextAttemptAt: null,
	lastSuccessAt: null,
};

/** Routes a fake `/api/webhooks/...` call for one webhook id, and records
 *  every path it was called with so a test can count the actual rounds. */
function stubFetch(webhookId: string) {
	const calls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		const path = String(url);
		calls.push(path);
		if (path === "/api/webhooks") {
			return jsonResponse({ data: [summary(webhookId, "pool-payouts")] });
		}
		if (path === `/api/webhooks/${webhookId}`) {
			return jsonResponse(detail(webhookId, "pool-payouts"));
		}
		if (path === `/api/webhooks/${webhookId}/deliveries`) {
			return jsonResponse({ data: [] });
		}
		if (path === `/api/webhooks/${webhookId}/dead`) {
			return jsonResponse({ data: [] });
		}
		if (path === `/api/webhooks/${webhookId}/activity`) {
			return jsonResponse(emptyActivity);
		}
		throw new Error(`unhandled path in test stub: ${path}`);
	}) as typeof fetch;
	return calls;
}

describe("refreshList", () => {
	test("caches the rows on an ok result", async () => {
		stubFetch("wh-1");
		const res = await refreshList();
		expect(res.kind).toBe("ok");
		expect(webhooksSnapshot().list?.data).toEqual([
			summary("wh-1", "pool-payouts"),
		]);
	});

	test("cached rows survive a slower refresh still in flight, then pick up its result", async () => {
		stubFetch("wh-1");
		await refreshList();

		let resolveSecond: (r: Response) => void = () => {};
		globalThis.fetch = (async (_url: string) =>
			new Promise<Response>((resolve) => {
				resolveSecond = resolve;
			})) as typeof fetch;

		const second = refreshList();
		// Still in flight: the cache keeps showing the first call's row.
		expect(webhooksSnapshot().list?.data).toEqual([
			summary("wh-1", "pool-payouts"),
		]);

		resolveSecond(jsonResponse({ data: [summary("wh-2", "renamed")] }));
		await second;
		expect(webhooksSnapshot().list?.data).toEqual([summary("wh-2", "renamed")]);
	});

	test("a 404 from the list endpoint resolves as an empty ok list", async () => {
		globalThis.fetch = (async (_url: string) =>
			jsonResponse({ error: "none" }, 404)) as typeof fetch;
		const res = await refreshList();
		expect(res).toEqual({ kind: "ok", data: [] });
		expect(webhooksSnapshot().list?.data).toEqual([]);
	});

	test("a rate-limited result is returned as-is and never clears an existing cache", async () => {
		stubFetch("wh-1");
		await refreshList();

		globalThis.fetch = (async (_url: string) =>
			jsonResponse({ error: "slow down" }, 429, {
				"Retry-After": "7",
			})) as typeof fetch;
		const res = await refreshList();
		expect(res).toEqual({ kind: "rate_limited", retryAfter: 7 });
		expect(webhooksSnapshot().list?.data).toEqual([
			summary("wh-1", "pool-payouts"),
		]);
	});
});

describe("refreshDetail", () => {
	test("starts all four reads together, not one after another", async () => {
		const starts: string[] = [];
		globalThis.fetch = (async (url: string) => {
			starts.push(String(url));
			// Resolving only after this turn lets every call register its start
			// before any of them finish — impossible if they ran one at a time.
			await Promise.resolve();
			if (String(url).endsWith("/deliveries"))
				return jsonResponse({ data: [] });
			if (String(url).endsWith("/dead")) return jsonResponse({ data: [] });
			if (String(url).endsWith("/activity")) return jsonResponse(emptyActivity);
			return jsonResponse(detail("wh-3", "pool-payouts"));
		}) as typeof fetch;

		await refreshDetail("wh-3");
		expect(starts.sort()).toEqual(
			[
				"/api/webhooks/wh-3",
				"/api/webhooks/wh-3/dead",
				"/api/webhooks/wh-3/deliveries",
				"/api/webhooks/wh-3/activity",
			].sort(),
		);
	});

	test("caches each slice independently on ok", async () => {
		stubFetch("wh-3b");
		await refreshDetail("wh-3b");
		const cache = webhooksSnapshot();
		expect(cache.detail["wh-3b"]?.data.name).toBe("pool-payouts");
		expect(cache.deliveries["wh-3b"]?.data).toEqual([]);
		expect(cache.dead["wh-3b"]?.data).toEqual([]);
		expect(cache.activity["wh-3b"]?.data).toEqual(emptyActivity);
	});
});

describe("prefetchDetail", () => {
	test("dedupes a second call while the first is still in flight", async () => {
		const calls = stubFetch("wh-4");
		prefetchDetail("wh-4");
		prefetchDetail("wh-4");
		await new Promise((r) => setTimeout(r, 0));
		await new Promise((r) => setTimeout(r, 0));
		const detailCalls = calls.filter((c) => c === "/api/webhooks/wh-4");
		expect(detailCalls.length).toBe(1);
	});

	test("skips refetching a cache entry younger than the freshness window", async () => {
		const calls = stubFetch("wh-5");
		await refreshDetail("wh-5");
		const before = calls.length;
		prefetchDetail("wh-5");
		await new Promise((r) => setTimeout(r, 0));
		expect(calls.length).toBe(before);
	});
});

describe("clearWebhooksData", () => {
	test("clears cached list and detail rows", async () => {
		stubFetch("wh-6");
		await refreshList();
		await refreshDetail("wh-6");
		expect(webhooksSnapshot().list).toBeDefined();

		clearWebhooksData();
		const cache = webhooksSnapshot();
		expect(cache.list).toBeUndefined();
		expect(cache.detail).toEqual({});
		expect(cache.deliveries).toEqual({});
		expect(cache.dead).toEqual({});
		expect(cache.activity).toEqual({});
	});
});

/** Advances fake time, then flushes the microtasks a `setTimeout` callback's
 *  own `await`s need to run and reschedule the next timer — plain
 *  `advanceTimersByTime` only fires callbacks synchronously up to their
 *  first `await`. */
async function advance(ms: number): Promise<void> {
	// Flush whatever microtask is still pending from the previous tick (e.g.
	// its own `setTimeout` re-registration) before moving the clock, and
	// again after, so this tick's continuation lands too.
	await Promise.resolve();
	await Promise.resolve();
	jest.advanceTimersByTime(ms);
	await Promise.resolve();
	await Promise.resolve();
}

describe("poll", () => {
	afterEach(() => {
		jest.useRealTimers();
		(globalThis as { document?: unknown }).document = undefined;
	});

	test("runs immediately, then again every interval", async () => {
		jest.useFakeTimers();
		const runs: number[] = [];
		const stop = poll(async () => {
			runs.push(Date.now());
			return undefined;
		}, 1000);
		expect(runs.length).toBe(1);
		await advance(1000);
		expect(runs.length).toBe(2);
		await advance(1000);
		await advance(1000);
		expect(runs.length).toBe(4);
		stop();
	});

	test("pauses while the document is hidden and resumes on visibilitychange", async () => {
		jest.useFakeTimers();
		let visibilityState = "hidden";
		const listeners = new Set<() => void>();
		(globalThis as { document?: unknown }).document = {
			get visibilityState() {
				return visibilityState;
			},
			addEventListener: (_event: string, cb: () => void) => {
				listeners.add(cb);
			},
			removeEventListener: (_event: string, cb: () => void) => {
				listeners.delete(cb);
			},
		};

		const runs: number[] = [];
		const stop = poll(async () => {
			runs.push(Date.now());
			return undefined;
		}, 1000);
		// Hidden from the start, so even the immediate call is skipped.
		expect(runs.length).toBe(0);

		await advance(3000);
		expect(runs.length).toBe(0);

		visibilityState = "visible";
		for (const cb of listeners) cb();
		await advance(0);
		expect(runs.length).toBe(1);

		await advance(1000);
		expect(runs.length).toBe(2);
		stop();
	});

	test("a visibility flap during an in-flight run doesn't fork a second loop", async () => {
		jest.useFakeTimers();
		let visibilityState = "visible";
		const listeners = new Set<() => void>();
		(globalThis as { document?: unknown }).document = {
			get visibilityState() {
				return visibilityState;
			},
			addEventListener: (_event: string, cb: () => void) => {
				listeners.add(cb);
			},
			removeEventListener: (_event: string, cb: () => void) => {
				listeners.delete(cb);
			},
		};

		const runs: number[] = [];
		let resolveRun: (() => void) | undefined;
		let callCount = 0;
		const stop = poll(() => {
			runs.push(Date.now());
			callCount += 1;
			// Only the first call stays pending (the in-flight run this test
			// flaps visibility during); later ticks resolve immediately so the
			// interval can keep going and prove it settles at a single cadence.
			if (callCount === 1) {
				return new Promise<undefined>((resolve) => {
					resolveRun = () => resolve(undefined);
				});
			}
			return Promise.resolve(undefined);
		}, 1000);

		// The first run is in flight, deliberately left unresolved.
		expect(runs.length).toBe(1);

		// Hidden then visible again while that run is still pending. A forked
		// loop would call `run` a second time right here, before the first
		// ever resolves.
		visibilityState = "hidden";
		for (const cb of listeners) cb();
		visibilityState = "visible";
		for (const cb of listeners) cb();
		expect(runs.length).toBe(1);

		// Resolve the in-flight run: only its own reschedule should follow,
		// at the plain interval — not a second, forked timer chain.
		resolveRun?.();
		await advance(0);
		expect(runs.length).toBe(1);

		await advance(1000);
		expect(runs.length).toBe(2);
		await advance(1000);
		expect(runs.length).toBe(3);
		stop();
	});
});
