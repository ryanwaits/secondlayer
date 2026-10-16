import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	clearInsights,
	dismiss,
	extraCount,
	forAccountRules,
	forResource,
	insightsSnapshot,
	markExpected,
	refreshInsights,
	topLine,
} from "./insights-store";
import { FIXTURE_INSIGHTS } from "./insights.fixtures";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearInsights();
});

function stubFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
	const calls: { url: string; method?: string }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), method: init?.method });
		return handler(String(url), init);
	}) as typeof fetch;
	return calls;
}

const list = (data = FIXTURE_INSIGHTS) =>
	new Response(JSON.stringify({ data }), { status: 200 });

describe("selectors", () => {
	test("forResource ranks the insights of one resource, worst first", () => {
		const rules = forResource(FIXTURE_INSIGHTS, "webhook", "wh-deposits").map(
			(i) => i.rule,
		);
		expect(rules[0]).toBe("receiver_down");
		expect(rules).not.toContain("filter_cannot_match");
	});

	test("forResource separates kinds that share an id", () => {
		expect(forResource(FIXTURE_INSIGHTS, "subgraph", "wh-deposits")).toEqual(
			[],
		);
	});

	test("forAccountRules keeps only the named account rules", () => {
		const rules = forAccountRules(FIXTURE_INSIGHTS, ["duplicate_reads"]).map(
			(i) => i.rule,
		);
		expect(rules).toEqual(["duplicate_reads"]);
		expect(forAccountRules(FIXTURE_INSIGHTS, ["receiver_down"])).toEqual([]);
	});

	test("topLine is the worst insight, extraCount the rest", () => {
		const count = forResource(
			FIXTURE_INSIGHTS,
			"webhook",
			"wh-deposits",
		).length;
		expect(topLine(FIXTURE_INSIGHTS, "webhook", "wh-deposits")?.rule).toBe(
			"receiver_down",
		);
		expect(extraCount(FIXTURE_INSIGHTS, "webhook", "wh-deposits")).toBe(
			count - 1,
		);
	});

	test("an unknown resource has no line and no extras", () => {
		expect(topLine(FIXTURE_INSIGHTS, "webhook", "nope")).toBeNull();
		expect(extraCount(FIXTURE_INSIGHTS, "webhook", "nope")).toBe(0);
	});
});

describe("store", () => {
	test("a good refresh fills the store, ranked", async () => {
		stubFetch(() => list());
		await refreshInsights();
		const { status, data } = insightsSnapshot();
		expect(status).toBe("ok");
		expect(data).toHaveLength(FIXTURE_INSIGHTS.length);
		expect(data[0]?.severity).toBe("losing");
	});

	test("dismiss removes optimistically and rolls back when the call fails", async () => {
		stubFetch(() => list());
		await refreshInsights();
		const id = FIXTURE_INSIGHTS[0]?.id ?? "";
		const calls = stubFetch((url) =>
			url.endsWith("/dismiss") ? new Response("{}", { status: 500 }) : list(),
		);
		const pending = dismiss(id);
		expect(insightsSnapshot().data.some((i) => i.id === id)).toBe(false);
		expect(await pending).toBe(false);
		expect(insightsSnapshot().data.some((i) => i.id === id)).toBe(true);
		expect(calls.some((c) => c.url === "/api/insights")).toBe(true);
	});

	test("a dismissed insight stays out of the store", async () => {
		stubFetch(() => list());
		await refreshInsights();
		const id = FIXTURE_INSIGHTS[0]?.id ?? "";
		const calls = stubFetch(() => new Response("{}", { status: 200 }));
		expect(await dismiss(id)).toBe(true);
		expect(insightsSnapshot().data.some((i) => i.id === id)).toBe(false);
		expect(await dismiss(id)).toBe(false);
		expect(calls).toHaveLength(1);
	});

	test("markExpected posts to the expected action and removes the insight", async () => {
		stubFetch(() => list());
		await refreshInsights();
		const id = FIXTURE_INSIGHTS[1]?.id ?? "";
		const calls = stubFetch(() => new Response("{}", { status: 200 }));
		expect(await markExpected(id)).toBe(true);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe(`/api/insights/${id}/expected`);
		expect(insightsSnapshot().data.some((i) => i.id === id)).toBe(false);
	});

	test("a failed refresh keeps the good data", async () => {
		stubFetch(() => list());
		await refreshInsights();
		stubFetch(() => new Response("{}", { status: 503 }));
		await refreshInsights();
		expect(insightsSnapshot().status).toBe("ok");
		expect(insightsSnapshot().data).toHaveLength(FIXTURE_INSIGHTS.length);
	});

	test("clearInsights forgets everything", async () => {
		stubFetch(() => list());
		await refreshInsights();
		clearInsights();
		expect(insightsSnapshot().data).toEqual([]);
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

function envelope(data: unknown): string {
	return JSON.stringify({ owner: null, savedAt: Date.now(), data });
}

describe("this tab's saved copy", () => {
	beforeEach(installStorage);
	afterEach(removeStorage);

	test("a successful refresh is saved for a reload", async () => {
		stubFetch(() => list());
		await refreshInsights();
		expect(storage.get("sl:dash:v1:insights")).toContain('"status":"ok"');
	});

	test("a failed first refresh saves nothing", async () => {
		stubFetch(() => new Response("{}", { status: 500 }));
		await refreshInsights();
		expect(storage.has("sl:dash:v1:insights")).toBe(false);
	});

	test("a reload reads the saved copy and clearing removes it", () => {
		clearInsights(); // resets the store as a fresh page load would
		storage.set(
			"sl:dash:v1:insights",
			envelope({ status: "ok", data: FIXTURE_INSIGHTS, at: 1 }),
		);
		expect(insightsSnapshot().data.length).toBe(FIXTURE_INSIGHTS.length);
		clearInsights();
		expect(storage.has("sl:dash:v1:insights")).toBe(false);
	});
});
