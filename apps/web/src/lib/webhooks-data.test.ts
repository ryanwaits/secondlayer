import { afterEach, describe, expect, test } from "bun:test";
import type { DeliveryRow } from "@secondlayer/sdk";
import {
	getDeliveries,
	listWebhooks,
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
