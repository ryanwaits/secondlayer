import { afterEach, describe, expect, test } from "bun:test";
import {
	clearAccountData,
	ensureKeys,
	refreshBilling,
	refreshKeys,
} from "./account-data";
import { refreshList, subgraphsSnapshot } from "./subgraphs-store";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	clearAccountData();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function stub(respond: (path: string) => Response): string[] {
	const calls: string[] = [];
	globalThis.fetch = (async (url: string) => {
		calls.push(String(url));
		return respond(String(url));
	}) as typeof fetch;
	return calls;
}

describe("shared reads", () => {
	test("two concurrent billing refreshes make one request", async () => {
		const calls = stub(() =>
			jsonResponse({ creditsUsdMicros: "1", spentThisMonthUsdMicros: "0" }),
		);
		await Promise.all([refreshBilling(), refreshBilling()]);
		expect(calls).toEqual(["/api/billing/status"]);
	});
});

describe("ensureKeys", () => {
	test("skips the request right after a successful load", async () => {
		const calls = stub(() => jsonResponse({ keys: [] }));
		await refreshKeys();
		await ensureKeys();
		expect(calls.length).toBe(1);
	});

	test("fetches again after a failed load", async () => {
		let status = 500;
		const calls = stub(() => jsonResponse({ keys: [] }, status));
		await refreshKeys();
		status = 200;
		await ensureKeys();
		expect(calls.length).toBe(2);
	});
});

describe("clearAccountData", () => {
	test("empties the subgraphs store", async () => {
		stub(() => jsonResponse({ data: [{ name: "pool", status: "active" }] }));
		await refreshList();
		expect(subgraphsSnapshot().list?.data.length).toBe(1);
		clearAccountData();
		expect(subgraphsSnapshot().list).toBeUndefined();
	});
});
