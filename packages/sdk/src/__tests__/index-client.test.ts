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

describe("SecondLayer Index client", () => {
	test("lists ft transfers with filters and auth", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({
				events: [],
				next_cursor: null,
				tip: { block_height: 10, lag_seconds: 1 },
				reorgs: [],
			});
		}) as typeof fetch;
		const client = new SecondLayer({
			baseUrl: "http://secondlayer.test",
			apiKey: "sk-test",
		});

		const response = await client.index.ftTransfers.list({
			cursor: "1:0",
			limit: 25,
			contractId: "SP1.token",
			sender: "SP1",
			recipient: "SP2",
			fromHeight: 1,
			toHeight: 2,
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/ft-transfers");
		expect(url.searchParams.get("cursor")).toBe("1:0");
		expect(url.searchParams.get("limit")).toBe("25");
		expect(url.searchParams.get("contract_id")).toBe("SP1.token");
		expect(url.searchParams.get("sender")).toBe("SP1");
		expect(url.searchParams.get("recipient")).toBe("SP2");
		expect(url.searchParams.get("from_height")).toBe("1");
		expect(url.searchParams.get("to_height")).toBe("2");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
		expect(response.reorgs).toEqual([]);
	});
});
