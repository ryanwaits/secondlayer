import { afterEach, describe, expect, test } from "bun:test";
import { SecondLayer } from "../index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

/** Records every request the client makes and answers each one with `body`. */
function recordRequests(body: unknown): Request[] {
	const requests: Request[] = [];
	globalThis.fetch = (async (input, init) => {
		const request =
			input instanceof Request ? input : new Request(input.toString(), init);
		requests.push(request);
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
	return requests;
}

describe("Subscriptions delivery log", () => {
	test("deliveries reads the delivery log for a subscription", async () => {
		const requests = recordRequests({
			data: [{ id: "dlv_1", attempt: 1, statusCode: 200 }],
		});

		const sl = new SecondLayer({
			baseUrl: "http://localhost:3800",
			apiKey: "sk-test",
		});
		const res = await sl.subscriptions.deliveries("sub_1");

		expect(res.data[0]?.id).toBe("dlv_1");
		expect(requests[0]?.url).toBe(
			"http://localhost:3800/api/subscriptions/sub_1/deliveries",
		);
		expect(requests[0]?.method).toBe("GET");
	});

	test("the removed recentDeliveries spelling is gone", () => {
		const sl = new SecondLayer({
			baseUrl: "http://localhost:3800",
			apiKey: "sk-test",
		});
		expect(
			(sl.subscriptions as unknown as Record<string, unknown>).recentDeliveries,
		).toBeUndefined();
	});
});

describe("Subscriptions dead-letter requeue", () => {
	test("requeue POSTs the outbox row back onto the delivery queue", async () => {
		const requests = recordRequests({ ok: true });

		const sl = new SecondLayer({
			baseUrl: "http://localhost:3800",
			apiKey: "sk-test",
		});
		const res = await sl.subscriptions.requeue("sub_1", "out_9");

		expect(res.ok).toBe(true);
		expect(requests[0]?.url).toBe(
			"http://localhost:3800/api/subscriptions/sub_1/dead/out_9/requeue",
		);
		expect(requests[0]?.method).toBe("POST");
	});

	test("the removed requeueDead spelling is gone", () => {
		const sl = new SecondLayer({
			baseUrl: "http://localhost:3800",
			apiKey: "sk-test",
		});
		expect(
			(sl.subscriptions as unknown as Record<string, unknown>).requeueDead,
		).toBeUndefined();
	});
});
