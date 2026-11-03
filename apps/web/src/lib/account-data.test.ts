import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AccountSeedProvider,
	CreateKeyError,
	accountSnapshot,
	clearAccountData,
	ensureBilling,
	ensureKeys,
	isTopupUsd,
	refreshBilling,
	refreshKeys,
	rotateKey,
	useAccountData,
} from "./account-data";
import { insightsSnapshot, refreshInsights } from "./insights-store";
import {
	refreshList as refreshSubgraphs,
	subgraphsSnapshot,
} from "./subgraphs-store";
import {
	refreshList as refreshWebhooks,
	webhooksSnapshot,
} from "./webhooks-store";

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
	test("skips the request when keys are already in the store", async () => {
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

describe("rotateKey", () => {
	test("posts to the key's rotate path, refreshes keys and returns the new secret", async () => {
		const calls = stub((path) =>
			path.endsWith("/rotate")
				? jsonResponse({ key: "sk-sl_new", name: "prod" }, 201)
				: jsonResponse({ keys: [] }),
		);
		const rotated = await rotateKey("key-1");
		expect(rotated).toEqual({ key: "sk-sl_new", name: "prod" });
		expect(calls).toEqual(["/api/keys/key-1/rotate", "/api/keys"]);
	});

	test("a rate limit throws with its retry delay and leaves the key list alone", async () => {
		const calls = stub(() =>
			jsonResponse({ error: "Slow down", retryAfter: 30 }, 429),
		);
		const err = await rotateKey("key-1").catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CreateKeyError);
		expect((err as CreateKeyError).status).toBe(429);
		expect((err as CreateKeyError).retryAfter).toBe(30);
		expect(calls).toEqual(["/api/keys/key-1/rotate"]);
	});
});

describe("this tab keeps no copy of the account", () => {
	test("a successful refresh writes nothing to sessionStorage", async () => {
		const saved = new Map<string, string>();
		globalThis.sessionStorage = {
			setItem: (k: string, v: string) => void saved.set(k, v),
		} as unknown as Storage;
		globalThis.window = {} as Window & typeof globalThis;
		try {
			stub(() => jsonResponse({ keys: [] }));
			await refreshKeys();
			expect(accountSnapshot().keys).toEqual([]);
			expect(saved.size).toBe(0);
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.sessionStorage = undefined;
			// @ts-expect-error restoring the bare test environment
			globalThis.window = undefined;
		}
	});
});

describe("sign-out", () => {
	test("empties every dashboard store, so the next account starts from nothing", async () => {
		stub((path) =>
			path === "/api/keys"
				? jsonResponse({ keys: [] })
				: jsonResponse({ data: [] }),
		);
		await Promise.all([
			refreshKeys(),
			refreshSubgraphs(),
			refreshWebhooks(),
			refreshInsights(),
		]);
		expect(accountSnapshot().keys).toEqual([]);
		expect(subgraphsSnapshot().list).toBeDefined();
		expect(webhooksSnapshot().list).toBeDefined();
		expect(insightsSnapshot().status).toBe("ok");
		clearAccountData();
		expect(accountSnapshot().keys).toBeNull();
		expect(subgraphsSnapshot().list).toBeUndefined();
		expect(webhooksSnapshot().list).toBeUndefined();
		expect(insightsSnapshot().status).toBe("idle");
	});
});

describe("server seed", () => {
	const seed = {
		billing: { creditsUsdMicros: "5000000", spentThisMonthUsdMicros: "0" },
		keys: [],
	};
	function Probe() {
		const { billing } = useAccountData();
		return createElement("p", null, `balance:${billing?.creditsUsdMicros}`);
	}
	const withSeed = () =>
		createElement(AccountSeedProvider, { seed }, createElement(Probe));

	test("the server render paints the seed and leaves the module store empty", () => {
		// No window here: this is the server, whose module state is shared
		// across requests and must never hold one account's data.
		const html = renderToStaticMarkup(withSeed());
		expect(html).toContain("balance:5000000");
		expect(accountSnapshot().billing).toBeNull();
	});

	test("the browser starts its store from the seed and does not read what it holds", async () => {
		globalThis.window = {} as Window & typeof globalThis;
		try {
			renderToStaticMarkup(withSeed());
			expect(accountSnapshot().billing?.creditsUsdMicros).toBe("5000000");
			const calls = stub(() => jsonResponse({}));
			await ensureKeys();
			await ensureBilling();
			expect(calls).toEqual([]);
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.window = undefined;
		}
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
