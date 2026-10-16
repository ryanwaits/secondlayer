import { afterEach, describe, expect, test } from "bun:test";
import { clearAccountData } from "./account-data";
import { resetWarmForTests, warmDashboard, warmTab } from "./dashboard-warm";
import { clearRequestCache } from "./request-cache";
import { clearSubgraphsData } from "./subgraphs-store";
import { clearWebhooksData } from "./webhooks-store";

const originalFetch = globalThis.fetch;
let urls: string[] = [];

function mockFetch(): void {
	urls = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		urls.push(String(input));
		return new Response(JSON.stringify({ data: [], keys: [], credits: [] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as unknown as typeof fetch;
}

const count = (path: string) =>
	urls.filter((u) => u.split("?")[0]?.endsWith(path)).length;
const settle = () => new Promise((r) => setTimeout(r, 20));

afterEach(() => {
	globalThis.fetch = originalFetch;
	clearAccountData();
	clearWebhooksData();
	clearSubgraphsData();
	clearRequestCache();
	resetWarmForTests();
});

describe("dashboard warm-up", () => {
	test("warming the keys tab requests keys once", async () => {
		mockFetch();
		warmTab("/account/keys");
		await settle();
		expect(count("/api/keys")).toBe(1);
	});

	test("warming webhooks reads the list and activity, never wakes a stack", async () => {
		mockFetch();
		warmTab("/account/webhooks");
		await settle();
		expect(count("/api/webhooks")).toBe(1);
		expect(count("/api/webhooks/activity")).toBe(1);
		expect(urls.some((u) => u.includes("wake"))).toBe(false);
	});

	test("warming the whole dashboard twice requests each endpoint once", async () => {
		mockFetch();
		warmDashboard();
		await settle();
		const first = [...urls];
		warmDashboard();
		await settle();
		expect(urls).toEqual(first);
		expect(new Set(urls).size).toBe(urls.length);
	});

	test("warming around the current tab still loads the others and shares keys", async () => {
		mockFetch();
		warmDashboard("/account/keys");
		await settle();
		expect(count("/api/billing/rows")).toBe(1);
		expect(count("/api/billing/credits")).toBe(1);
		expect(count("/api/webhooks")).toBe(1);
		expect(count("/api/subgraphs")).toBe(1);
		expect(count("/api/keys")).toBe(1);
	});

	test("warming subgraphs asks for the list with its health in one request", async () => {
		mockFetch();
		warmTab("/account/subgraphs");
		await settle();
		expect(urls.filter((u) => u.startsWith("/api/subgraphs"))).toEqual([
			"/api/subgraphs?health=24",
		]);
	});

	test("a slice read moments ago is not read again", async () => {
		mockFetch();
		warmTab("/account/keys");
		await settle();
		warmTab("/account/keys");
		await settle();
		expect(count("/api/keys")).toBe(1);
	});

	test("an unknown tab requests nothing", async () => {
		mockFetch();
		warmTab("/nope");
		await settle();
		expect(urls).toEqual([]);
	});
});
