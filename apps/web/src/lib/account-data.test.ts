import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AccountSeedProvider,
	CreateKeyError,
	accountSnapshot,
	clearAccountData,
	creditsBaseline,
	ensureBilling,
	ensureKeys,
	formatAge,
	formatDate,
	formatDateTime,
	isTopupUsd,
	refreshBilling,
	refreshKeys,
	resourceOf,
	rotateKey,
	topupStatus,
	updateCap,
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

describe("topupStatus", () => {
	const topup = (occurredAt: string, usd: number) => ({
		occurredAt,
		kind: "topup" as const,
		source: "stripe:checkout",
		usdMicros: String(usd * 1_000_000),
	});
	const old = topup("2026-11-01T10:00:00.000Z", 25);
	const fresh = topup("2026-11-07T10:00:00.000Z", 25);

	test("with no baseline it is unknown, never landed, even when the list has top-ups", () => {
		expect(topupStatus([old, fresh], 25, null)).toBe("unknown");
		expect(topupStatus(null, null, null)).toBe("unknown");
	});

	test("an old top-up does not count as the new one", () => {
		expect(topupStatus([old], 25, creditsBaseline([old]))).toBe("waiting");
	});

	test("a newer top-up for the amount lands, whatever the balance did meanwhile", () => {
		const baseline = creditsBaseline([old]);
		expect(topupStatus([fresh, old], 25, baseline)).toBe("landed");
	});

	test("a newer top-up for a different amount is not this one", () => {
		const baseline = creditsBaseline([old]);
		expect(
			topupStatus([topup("2026-11-07T10:00:00.000Z", 50), old], 25, baseline),
		).toBe("waiting");
		expect(
			topupStatus([topup("2026-11-07T10:00:00.000Z", 50), old], null, baseline),
		).toBe("landed");
	});

	test("a grant is never a top-up", () => {
		const grant = { ...fresh, kind: "grant" as const };
		expect(topupStatus([grant], 25, creditsBaseline([old]))).toBe("waiting");
	});

	test("an account with no earlier top-up lands on its first", () => {
		expect(topupStatus([fresh], 25, creditsBaseline([]))).toBe("landed");
		expect(topupStatus(null, 25, creditsBaseline([]))).toBe("waiting");
	});

	test("an unreadable credits list gives no baseline", () => {
		expect(creditsBaseline(null)).toBeNull();
		expect(creditsBaseline([old, fresh])).toEqual({
			latestTopupAt: fresh.occurredAt,
		});
	});
});

describe("a slot that failed to load", () => {
	test("reads as an error, not as still loading, and a retry fills it", async () => {
		let status = 500;
		stub(() => jsonResponse({ keys: [] }, status));
		expect(resourceOf(accountSnapshot(), "keys")).toEqual({ status: "idle" });
		await refreshKeys();
		expect(resourceOf(accountSnapshot(), "keys")).toEqual({ status: "error" });
		status = 200;
		await refreshKeys();
		expect(resourceOf(accountSnapshot(), "keys")).toEqual({
			status: "ok",
			data: [],
		});
		expect(accountSnapshot().status.keys).toBeUndefined();
	});

	test("a network failure is an error too", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("offline");
		}) as unknown as typeof fetch;
		await refreshKeys();
		expect(resourceOf(accountSnapshot(), "keys")).toEqual({ status: "error" });
	});

	test("a failed refresh keeps the data it had", async () => {
		let status = 200;
		stub(() => jsonResponse({ keys: [] }, status));
		await refreshKeys();
		status = 500;
		await refreshKeys();
		expect(resourceOf(accountSnapshot(), "keys")).toEqual({
			status: "ok",
			data: [],
		});
	});

	test("a read still under way shows as loading", async () => {
		let release: (r: Response) => void = () => {};
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			})) as unknown as typeof fetch;
		const pending = refreshKeys();
		expect(resourceOf(accountSnapshot(), "keys")).toEqual({
			status: "loading",
		});
		release(jsonResponse({ keys: [] }));
		await pending;
	});
});

describe("a read that outlives sign-out", () => {
	test("does not refill the store for the next account", async () => {
		let release: (r: Response) => void = () => {};
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			})) as unknown as typeof fetch;
		const pending = refreshKeys();
		clearAccountData();
		release(jsonResponse({ keys: [{ id: "old-account-key" }] }));
		await pending;
		expect(accountSnapshot().keys).toBeNull();
		expect(accountSnapshot().status).toEqual({});
	});
});

describe("spend cap saves", () => {
	const capResponse = (cents: number) => ({
		monthlyCapCents: cents,
		alertThresholdPct: 80,
		frozenAt: null,
		alertSentAt: null,
	});

	test("a slower older save never overwrites a newer one in the store", async () => {
		const releases: ((r: Response) => void)[] = [];
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				releases.push(resolve);
			})) as unknown as typeof fetch;
		const first = updateCap(1000);
		const second = updateCap(2000);
		releases[1](jsonResponse(capResponse(2000)));
		await second;
		releases[0](jsonResponse(capResponse(1000)));
		await first;
		expect(accountSnapshot().caps?.monthlyCapCents).toBe(2000);
	});
});

describe("formatDate", () => {
	test("is the same calendar day for everyone, whatever their timezone", () => {
		const saved = process.env.TZ;
		process.env.TZ = "America/Los_Angeles";
		try {
			expect(formatDate("2026-11-01T01:00:00.000Z")).toBe("Nov 1, 2026");
		} finally {
			if (saved === undefined) Reflect.deleteProperty(process.env, "TZ");
			else process.env.TZ = saved;
		}
	});

	test("names a missing date", () => {
		expect(formatDate(null)).toBe("never");
	});
});

describe("formatAge", () => {
	const now = Date.parse("2026-11-08T12:00:00.000Z");
	test("spells out the coarsest whole unit", () => {
		expect(formatAge("2026-11-03T09:00:00.000Z", now)).toBe("5 days ago");
		expect(formatAge("2026-11-08T09:00:00.000Z", now)).toBe("3 hours ago");
		expect(formatAge("2026-11-07T11:00:00.000Z", now)).toBe("1 day ago");
		expect(formatAge("2026-08-01T12:00:00.000Z", now)).toBe("3 months ago");
		expect(formatAge("2024-11-01T12:00:00.000Z", now)).toBe("2 years ago");
	});
	test("reads under a minute, or a clock behind the server, as just now", () => {
		expect(formatAge("2026-11-08T11:59:30.000Z", now)).toBe("just now");
		expect(formatAge("2026-11-08T12:00:30.000Z", now)).toBe("just now");
	});
});

describe("formatDateTime", () => {
	test("gives the UTC date and 24-hour time", () => {
		expect(formatDateTime("2026-11-03T14:21:09.000Z")).toBe(
			"Nov 3, 2026, 14:21 UTC",
		);
		expect(formatDateTime("2026-11-03T00:05:00.000Z")).toBe(
			"Nov 3, 2026, 00:05 UTC",
		);
	});
});
