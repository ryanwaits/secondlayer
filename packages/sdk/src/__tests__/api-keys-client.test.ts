import { afterEach, describe, expect, test } from "bun:test";
import { SecondLayer } from "../index.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("ApiKeys client", () => {
	test("is wired onto the root client", () => {
		expect(typeof new SecondLayer().apiKeys.create).toBe("function");
	});

	test("POSTs product + name to /v1/api-keys and returns the minted key", async () => {
		const requests: Request[] = [];
		const bodies: unknown[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			bodies.push(init?.body ? JSON.parse(init.body as string) : undefined);
			return jsonResponse(
				{
					key: "sk-sl_minted",
					prefix: "sk-sl_min",
					id: "key-1",
					product: "streams",
					tier: null,
					createdAt: "2026-06-04T00:00:00.000Z",
				},
				201,
			);
		}) as typeof fetch;

		const sl = new SecondLayer({ apiKey: "sk-owner" });
		const res = await sl.apiKeys.create({ product: "streams", name: "ci" });

		expect(res.key).toBe("sk-sl_minted");
		expect(res.product).toBe("streams");

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/api-keys");
		expect(requests[0]?.method).toBe("POST");
		expect(bodies[0]).toEqual({ product: "streams", name: "ci" });
	});
});
