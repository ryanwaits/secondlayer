import { afterEach, describe, expect, test } from "bun:test";
import type { DeliveryRow } from "@secondlayer/sdk";
import {
	formatRelative,
	getActivity,
	getActivitySummary,
	getDeliveries,
	hostOf,
	listWebhooks,
	normalizeDeliveryRow,
	renameWebhook,
} from "./webhooks-data";

const baseRow: DeliveryRow = {
	id: "del-1",
	attempt: 1,
	statusCode: 200,
	errorMessage: null,
	durationMs: 100,
	responseBody: null,
	dispatchedAt: "2026-09-25T00:00:00.000Z",
	blockHeight: 100,
	blockTime: "2026-09-25T00:00:00.000Z",
	txId: null,
	eventIndex: null,
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

describe("getDeliveries window", () => {
	test("sends the from and to bounds as query params", async () => {
		const calls = stubFetch(
			() => new Response(JSON.stringify({ data: [] }), { status: 200 }),
		);
		await getDeliveries("wh_1", {
			from: "2026-10-08T16:00:00.000Z",
			to: "2026-10-08T17:00:00.000Z",
		});
		const url = new URL(calls[0]?.url ?? "", "http://x");
		expect(url.pathname).toBe("/api/webhooks/wh_1/deliveries");
		expect(url.searchParams.get("from")).toBe("2026-10-08T16:00:00.000Z");
		expect(url.searchParams.get("to")).toBe("2026-10-08T17:00:00.000Z");
	});
});

describe("getActivity", () => {
	test("one plain call carries the hours and the 30 days", async () => {
		const calls = stubFetch(() => new Response("{}", { status: 200 }));
		await getActivity("wh_1");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("/api/webhooks/wh_1/activity");
	});
});

describe("getActivitySummary", () => {
	test("a 404 (no hosted stack yet) reads as no activity", async () => {
		stubFetch(() => new Response("{}", { status: 404 }));
		expect(await getActivitySummary()).toEqual({
			kind: "ok",
			data: { hours: [], webhooks: [] },
		});
	});

	test("passes the summary through on success", async () => {
		const body = { hours: ["2026-10-08T00:00:00.000Z"], webhooks: [] };
		stubFetch(() => new Response(JSON.stringify(body), { status: 200 }));
		expect(await getActivitySummary()).toEqual({ kind: "ok", data: body });
	});
});

describe("renameWebhook", () => {
	test("PATCHes only the name", async () => {
		const calls = stubFetch(
			() => new Response(JSON.stringify({ id: "wh_1" }), { status: 200 }),
		);
		await renameWebhook("wh_1", "vault-events");
		expect(calls[0]?.init?.method).toBe("PATCH");
		expect(calls[0]?.init?.body).toBe(JSON.stringify({ name: "vault-events" }));
	});

	test("a 409 comes back as an error with the API's text", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ error: "Name already in use" }), {
					status: 409,
				}),
		);
		expect(await renameWebhook("wh_1", "vault-events")).toEqual({
			kind: "error",
			message: "Name already in use",
		});
	});
});
