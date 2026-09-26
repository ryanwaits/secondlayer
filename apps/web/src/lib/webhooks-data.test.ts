import { afterEach, describe, expect, test } from "bun:test";
import type { DeliveryRow } from "@secondlayer/sdk";
import {
	dismissInsight,
	formatRelative,
	getDeliveries,
	hasShownToast,
	hostOf,
	isInsightDismissed,
	listWebhooks,
	markToastShown,
	normalizeDeliveryRow,
	resultForStatus,
} from "./webhooks-data";

describe("resultForStatus", () => {
	test("a 2xx maps to null (caller reads the body)", () => {
		expect(resultForStatus(200, null, "")).toBeNull();
		expect(resultForStatus(201, null, "")).toBeNull();
	});
	test("503 → starting, with Retry-After parsed or defaulted to 30", () => {
		expect(resultForStatus(503, "45", "")).toEqual({
			kind: "starting",
			retryAfter: 45,
		});
		expect(resultForStatus(503, null, "")).toEqual({
			kind: "starting",
			retryAfter: 30,
		});
	});
	test("402 → no_credits", () => {
		expect(resultForStatus(402, null, "")).toEqual({ kind: "no_credits" });
	});
	test("429 → rate_limited, with Retry-After parsed", () => {
		expect(resultForStatus(429, "12", "")).toEqual({
			kind: "rate_limited",
			retryAfter: 12,
		});
	});
	test("404 → not_found", () => {
		expect(resultForStatus(404, null, "")).toEqual({ kind: "not_found" });
	});
	test("anything else → error, carrying the given message", () => {
		expect(resultForStatus(500, null, "boom")).toEqual({
			kind: "error",
			message: "boom",
		});
		expect(resultForStatus(401, null, "Sign in first")).toEqual({
			kind: "error",
			message: "Sign in first",
		});
	});
});

const baseRow: DeliveryRow = {
	id: "del-1",
	attempt: 1,
	statusCode: 200,
	errorMessage: null,
	durationMs: 100,
	responseBody: null,
	dispatchedAt: "2026-09-25T00:00:00.000Z",
	blockTime: "2026-09-25T00:00:00.000Z",
};

describe("normalizeDeliveryRow", () => {
	test("leaves a present blockTime alone", () => {
		expect(normalizeDeliveryRow(baseRow).blockTime).toBe(
			"2026-09-25T00:00:00.000Z",
		);
	});
	test("leaves an explicit null alone", () => {
		expect(
			normalizeDeliveryRow({ ...baseRow, blockTime: null }).blockTime,
		).toBe(null);
	});
	test("normalizes a missing blockTime (older tenant API) to null", () => {
		const { blockTime: _drop, ...withoutBlockTime } = baseRow;
		expect(
			normalizeDeliveryRow(withoutBlockTime as DeliveryRow).blockTime,
		).toBe(null);
	});
});

describe("formatRelative", () => {
	const now = new Date("2026-09-25T12:00:00.000Z").getTime();
	test("never for null", () => {
		expect(formatRelative(null, now)).toBe("never");
	});
	test("seconds, minutes, hours, and days ago", () => {
		expect(formatRelative(new Date(now - 12_000).toISOString(), now)).toBe(
			"12s ago",
		);
		expect(formatRelative(new Date(now - 41 * 60_000).toISOString(), now)).toBe(
			"41m ago",
		);
		expect(
			formatRelative(new Date(now - 3 * 3_600_000).toISOString(), now),
		).toBe("3h ago");
		expect(
			formatRelative(new Date(now - 3 * 86_400_000).toISOString(), now),
		).toBe("3d ago");
	});
});

class FakeLocalStorage {
	private store = new Map<string, string>();
	getItem(key: string): string | null {
		return this.store.has(key) ? (this.store.get(key) as string) : null;
	}
	setItem(key: string, value: string): void {
		this.store.set(key, value);
	}
}

describe("insight memory (toast-once and dismiss)", () => {
	const originalLocalStorage = (globalThis as { localStorage?: unknown })
		.localStorage;

	afterEach(() => {
		(globalThis as { localStorage?: unknown }).localStorage =
			originalLocalStorage;
	});

	test("a toast is remembered per (webhook, rule), independent of other rules/webhooks", () => {
		(globalThis as { localStorage?: unknown }).localStorage =
			new FakeLocalStorage();
		expect(hasShownToast("wh-1", "circuit")).toBe(false);
		markToastShown("wh-1", "circuit");
		expect(hasShownToast("wh-1", "circuit")).toBe(true);
		expect(hasShownToast("wh-1", "paused")).toBe(false);
		expect(hasShownToast("wh-2", "circuit")).toBe(false);
	});

	test("a dismissal is remembered per (webhook, rule)", () => {
		(globalThis as { localStorage?: unknown }).localStorage =
			new FakeLocalStorage();
		expect(isInsightDismissed("wh-1", "paused")).toBe(false);
		dismissInsight("wh-1", "paused");
		expect(isInsightDismissed("wh-1", "paused")).toBe(true);
	});

	test("never throws with no localStorage, and just reports 'not shown/dismissed'", () => {
		(globalThis as { localStorage?: unknown }).localStorage = undefined;
		expect(() => hasShownToast("wh-1", "circuit")).not.toThrow();
		expect(hasShownToast("wh-1", "circuit")).toBe(false);
		expect(() => markToastShown("wh-1", "circuit")).not.toThrow();
		expect(() => isInsightDismissed("wh-1", "paused")).not.toThrow();
		expect(isInsightDismissed("wh-1", "paused")).toBe(false);
		expect(() => dismissInsight("wh-1", "paused")).not.toThrow();
	});
});

describe("hostOf", () => {
	test("extracts the host from a webhook URL", () => {
		expect(hostOf("https://hooks.pool.example/stacks/payouts")).toBe(
			"hooks.pool.example",
		);
	});
	test("falls back to a naive strip for something that fails URL parsing", () => {
		expect(hostOf("not a url")).toBe("not a url");
	});
});

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return handler(String(url), init);
	}) as typeof fetch;
	return calls;
}

describe("listWebhooks", () => {
	test("unwraps the envelope on success", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ data: [{ id: "wh_1" }] }), {
					status: 200,
				}),
		);
		const res = await listWebhooks();
		expect(res).toEqual({ kind: "ok", data: [{ id: "wh_1" }] as never });
	});

	test("maps a 503 to starting without throwing", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ error: "provisioning" }), {
					status: 503,
					headers: { "Retry-After": "30" },
				}),
		);
		const res = await listWebhooks();
		expect(res).toEqual({ kind: "starting", retryAfter: 30 });
	});
});

describe("getDeliveries", () => {
	test("normalizes blockTime on every row in the list", async () => {
		stubFetch(
			() =>
				new Response(
					JSON.stringify({
						data: [{ ...baseRow, blockTime: undefined }],
					}),
					{ status: 200 },
				),
		);
		const res = await getDeliveries("wh_1");
		expect(res.kind).toBe("ok");
		if (res.kind === "ok") {
			expect(res.data[0]?.blockTime).toBe(null);
		}
	});
});
