import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	accountSnapshot,
	adoptCacheOwner,
	clearAccountData,
	ensureKeys,
	isTopupUsd,
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
		stub(() => jsonResponse({ keys: [] }));
		await refreshKeys();
		expect(storage.get("sl:dash:v1:account")).toContain('"keys":[]');
	});

	test("a reload reads the saved copy and clearing removes it", () => {
		clearAccountData(); // resets the store as a fresh page load would
		storage.set(
			"sl:dash:v1:account",
			envelope({
				billing: { creditsUsdMicros: "5", spentThisMonthUsdMicros: "0" },
			}),
		);
		expect(accountSnapshot().billing?.creditsUsdMicros).toBe("5");
		clearAccountData();
		expect(storage.has("sl:dash:v1:account")).toBe(false);
	});
});

describe("adoptCacheOwner", () => {
	beforeEach(installStorage);
	afterEach(removeStorage);

	async function seed() {
		stub(() => jsonResponse({ keys: [] }));
		await refreshKeys();
	}

	test("a different account empties the store and its saved copy", async () => {
		adoptCacheOwner("a");
		await seed();
		expect(accountSnapshot().keys).toEqual([]);
		adoptCacheOwner("b");
		expect(accountSnapshot().keys).toBeNull();
		expect(storage.has("sl:dash:v1:account")).toBe(false);
	});

	test("a signed-out answer with an owner set clears", async () => {
		adoptCacheOwner("a");
		await seed();
		adoptCacheOwner(null);
		expect(accountSnapshot().keys).toBeNull();
		expect(storage.has("sl:dash:v1:owner")).toBe(false);
	});

	test("the same account twice keeps the data", async () => {
		adoptCacheOwner("a");
		await seed();
		adoptCacheOwner("a");
		expect(accountSnapshot().keys).toEqual([]);
	});
});

describe("isTopupUsd", () => {
	test("accepts whole dollars from 5 to 1000 only", () => {
		expect(isTopupUsd(4)).toBe(false);
		expect(isTopupUsd(5)).toBe(true);
		expect(isTopupUsd(1000)).toBe(true);
		expect(isTopupUsd(1000.5)).toBe(false);
		expect(isTopupUsd(1001)).toBe(false);
	});
});
