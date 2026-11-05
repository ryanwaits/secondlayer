import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type {
	WebhookActivity,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clearRequestCache } from "./request-cache";
import {
	type DetailFetch,
	MAX_WINDOWS,
	type WebhooksSeed,
	applyWebhook,
	clearWebhooksData,
	detailSeed,
	poll,
	refreshDeliveriesWindow,
	refreshDetail,
	refreshList,
	useWebhooksCache,
	webhooksSnapshot,
} from "./webhooks-store";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	clearWebhooksData();
	clearRequestCache();
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
		format: "standard-webhooks",
		url: "https://example.com/webhook",
		lastDeliveryAt: null,
		lastSuccessAt: null,
		circuitOpenedAt: null,
		circuitFailures: 0,
		managedBy: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

function detail(id: string, name: string): WebhookDetail {
	return {
		...summary(id, name),
		triggers: [{ type: "stx_transfer" }],
		auth: { type: "none", headerNames: [], hasSecret: false },
		maxRetries: 7,
		timeoutMs: 10_000,
		concurrency: 8,
		lastError: null,
		receiverCertExpiresAt: null,
		warning: null,
	};
}

const emptyActivity: WebhookActivity = {
	hours: [],
	waiting: 0,
	nextAttemptAt: null,
	lastSuccessAt: null,
	byEventType: {},
	usualByHourOfDay: null,
	days: [],
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
		if (path === `/api/webhooks/${webhookId}/activity`) {
			return jsonResponse(emptyActivity);
		}
		throw new Error(`unhandled path in test stub: ${path}`);
	}) as typeof fetch;
	return calls;
}

describe("refreshList", () => {
	test("concurrent calls share one request", async () => {
		const calls = stubFetch("wh-share");
		await Promise.all([refreshList(), refreshList()]);
		expect(calls.filter((c) => c === "/api/webhooks").length).toBe(1);
	});

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
	test("starts every detail read together, not one after another", async () => {
		const starts: string[] = [];
		globalThis.fetch = (async (url: string) => {
			starts.push(String(url));
			// Resolving only after this turn lets every call register its start
			// before any of them finish — impossible if they ran one at a time.
			await Promise.resolve();
			if (String(url).endsWith("/deliveries"))
				return jsonResponse({ data: [] });
			if (String(url).endsWith("/activity")) return jsonResponse(emptyActivity);
			return jsonResponse(detail("wh-3", "pool-payouts"));
		}) as typeof fetch;

		await refreshDetail("wh-3");
		expect(starts.sort()).toEqual(
			[
				"/api/webhooks/wh-3",
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
		expect(cache.activity["wh-3b"]?.data).toEqual(emptyActivity);
	});

	test("skips the activity read when told to exclude it", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			const path = String(url);
			calls.push(path);
			if (path.endsWith("/deliveries")) return jsonResponse({ data: [] });
			if (path.endsWith("/activity")) {
				throw new Error("activity should not be fetched when excluded");
			}
			return jsonResponse(detail("wh-3c", "pool-payouts"));
		}) as typeof fetch;

		const res = await refreshDetail("wh-3c", { activity: false });
		expect(calls.length).toBe(2);
		expect(res.activity).toBeNull();
		expect(webhooksSnapshot().activity["wh-3c"]).toBeUndefined();
	});
});

describe("a webhook that goes missing", () => {
	test("a 404 after the page had it drops it everywhere and keeps its name", async () => {
		stubFetch("wh-gone");
		await refreshList();
		await refreshDetail("wh-gone");
		clearRequestCache();
		globalThis.fetch = (async () =>
			jsonResponse({ error: "not found" }, 404)) as unknown as typeof fetch;
		await refreshDetail("wh-gone");
		const cache = webhooksSnapshot();
		expect(cache.missing["wh-gone"]).toBe("pool-payouts");
		expect(cache.detail["wh-gone"]).toBeUndefined();
		expect(cache.list?.data.some((w) => w.id === "wh-gone")).toBe(false);
	});

	test("a 404 for an id this cache never had is missing with no name", async () => {
		globalThis.fetch = (async () =>
			jsonResponse({ error: "not found" }, 404)) as unknown as typeof fetch;
		await refreshDetail("wh-typo");
		expect(webhooksSnapshot().missing["wh-typo"]).toBeNull();
	});

	test("a later ok clears the missing mark", async () => {
		globalThis.fetch = (async () =>
			jsonResponse({ error: "not found" }, 404)) as unknown as typeof fetch;
		await refreshDetail("wh-back");
		clearRequestCache();
		stubFetch("wh-back");
		await refreshDetail("wh-back");
		expect("wh-back" in webhooksSnapshot().missing).toBe(false);
	});
});

describe("refreshDeliveriesWindow", () => {
	test("keeps the newest windows and drops the oldest past the cap", async () => {
		globalThis.fetch = (async () =>
			jsonResponse({ data: [] })) as unknown as typeof fetch;
		const now = jest.spyOn(Date, "now");
		for (let i = 0; i <= MAX_WINDOWS; i++) {
			now.mockReturnValue(1_000 + i);
			await refreshDeliveriesWindow("w1", {
				from: `from-${i}`,
				to: `to-${i}`,
			});
		}
		now.mockRestore();
		const keys = Object.keys(webhooksSnapshot().deliveriesWindow);
		expect(keys.length).toBe(MAX_WINDOWS);
		expect(keys).not.toContain("w1:from-0");
		expect(keys).toContain(`w1:from-${MAX_WINDOWS}`);
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

	test("a poll told not to start immediately waits one interval", async () => {
		jest.useFakeTimers();
		const runs: number[] = [];
		const stop = poll(
			() => {
				runs.push(Date.now());
				return Promise.resolve(undefined);
			},
			1000,
			{ immediate: false },
		);
		expect(runs.length).toBe(0);
		await advance(999);
		expect(runs.length).toBe(0);
		await advance(1);
		expect(runs.length).toBe(1);
		stop();
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

const storage = new Map<string, string>();

function installStorage() {
	storage.clear();
	globalThis.sessionStorage = {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => void storage.set(k, v),
		removeItem: (k: string) => void storage.delete(k),
		key: (i: number) => [...storage.keys()][i] ?? null,
		get length() {
			return storage.size;
		},
	} as unknown as Storage;
	globalThis.window = {} as Window & typeof globalThis;
}

function removeStorage() {
	// @ts-expect-error restoring the bare test environment
	globalThis.sessionStorage = undefined;
	// @ts-expect-error restoring the bare test environment
	globalThis.window = undefined;
}

describe("sessionStorage", () => {
	beforeEach(installStorage);
	afterEach(removeStorage);

	test("refreshing the list saves nothing for a reload", async () => {
		globalThis.fetch = (async () =>
			jsonResponse({
				data: [summary("w1", "one")],
			})) as unknown as typeof fetch;
		await refreshList();
		expect(webhooksSnapshot().list?.data[0]?.id).toBe("w1");
		expect(storage.size).toBe(0);
	});

	test("a detail refresh saves nothing for a reload", async () => {
		globalThis.fetch = (async (url: string) => {
			if (String(url).includes("/activity")) return jsonResponse(emptyActivity);
			if (String(url).includes("/deliveries"))
				return jsonResponse({ data: [] });
			return jsonResponse(detail("w1", "one"));
		}) as unknown as typeof fetch;
		await refreshDetail("w1");
		expect(storage.size).toBe(0);
	});
});

describe("server seed", () => {
	const initial: DetailFetch = {
		webhook: { kind: "ok", data: detail("w1", "one") },
		deliveries: { kind: "ok", data: [] },
		activity: { kind: "ok", data: emptyActivity },
	};

	function Probe({ seed }: { seed: WebhooksSeed }) {
		const cache = useWebhooksCache(seed);
		return createElement("p", null, cache.detail.w1?.data.name ?? "empty");
	}

	test("detailSeed keeps only the reads that came back ok", () => {
		const seed = detailSeed("w1", {
			...initial,
			deliveries: { kind: "asleep" },
			activity: null,
		});
		expect(Object.keys(seed).sort()).toEqual(["detail"]);
		expect(seed.detail?.w1?.data.name).toBe("one");
	});

	test("detailSeed returns the same seed for the same server read", () => {
		expect(detailSeed("w1", initial)).toBe(detailSeed("w1", initial));
	});

	test("the server render paints the seed and leaves the module cache empty", () => {
		// No window here: this is the server, whose module state is shared
		// across requests and must never hold one account's rows.
		const html = renderToStaticMarkup(
			createElement(Probe, { seed: detailSeed("w1", initial) }),
		);
		expect(html).toContain("one");
		expect(webhooksSnapshot().detail.w1).toBeUndefined();
	});

	test("the seeded deliveries entry stays the cached one until a refresh replaces it", async () => {
		globalThis.window = {} as Window & typeof globalThis;
		try {
			const seed = detailSeed("w1", { ...initial });
			renderToStaticMarkup(createElement(Probe, { seed }));
			// The page tells "still the server's first page" from "the full
			// list landed" by this identity.
			expect(webhooksSnapshot().deliveries.w1).toBe(seed.deliveries?.w1);
			globalThis.fetch = (async (url: string) => {
				if (String(url).includes("/activity"))
					return jsonResponse(emptyActivity);
				if (String(url).includes("/deliveries"))
					return jsonResponse({ data: [] });
				return jsonResponse(detail("w1", "one"));
			}) as unknown as typeof fetch;
			await refreshDetail("w1");
			expect(webhooksSnapshot().deliveries.w1).not.toBe(seed.deliveries?.w1);
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.window = undefined;
		}
	});

	test("a browser render starts the cache from the seed once", () => {
		globalThis.window = {} as Window & typeof globalThis;
		try {
			const seed = detailSeed("w1", initial);
			renderToStaticMarkup(createElement(Probe, { seed }));
			expect(webhooksSnapshot().detail.w1?.data.name).toBe("one");
			// A poll lands, then the same render happens again: the seed
			// doesn't overwrite what the poll found.
			applyWebhook({ ...detail("w1", "renamed") });
			renderToStaticMarkup(createElement(Probe, { seed }));
			expect(webhooksSnapshot().detail.w1?.data.name).toBe("renamed");
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.window = undefined;
		}
	});
});
