import { afterEach, describe, expect, test } from "bun:test";
import { SecondLayer } from "../index.ts";

const originalFetch = globalThis.fetch;
const TIP = { block_height: 10, lag_seconds: 1 };

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function captureFetch(body: unknown): Request[] {
	const requests: Request[] = [];
	globalThis.fetch = (async (input, init) => {
		const request =
			input instanceof Request ? input : new Request(input.toString(), init);
		requests.push(request);
		return jsonResponse(body);
	}) as typeof fetch;
	return requests;
}

const EMPTY_EVENTS = { events: [], next_cursor: null, tip: TIP, reorgs: [] };

describe("Index callable resources", () => {
	test("index.ftTransfers(params) is shorthand for .list(params)", async () => {
		const requests = captureFetch(EMPTY_EVENTS);
		const sl = new SecondLayer({ baseUrl: "https://api.test" });

		const envelope = await sl.index.ftTransfers({
			contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
			limit: 5,
		});

		expect(envelope.events).toEqual([]);
		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/ft-transfers");
		expect(url.searchParams.get("contract_id")).toBe(
			"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
		);
		expect(url.searchParams.get("limit")).toBe("5");

		// Back-compat: .list still works and hits the same route.
		await sl.index.ftTransfers.list({ sender: "SP1" });
		expect(new URL(requests[1]?.url ?? "").pathname).toBe(
			"/v1/index/ft-transfers",
		);
	});

	test("index.nftTransfers(params) is shorthand for .list(params)", async () => {
		const requests = captureFetch(EMPTY_EVENTS);
		const sl = new SecondLayer({ baseUrl: "https://api.test" });

		await sl.index.nftTransfers({ assetIdentifier: "SP1.c::t" });
		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/nft-transfers");
		expect(url.searchParams.get("asset_identifier")).toBe("SP1.c::t");
	});

	test("index.events(params) is shorthand for .list(params)", async () => {
		const requests = captureFetch(EMPTY_EVENTS);
		const sl = new SecondLayer({ baseUrl: "https://api.test" });

		await sl.index.events({ eventType: "ft_transfer", cursor: "1:0" });
		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/index/events");
		expect(url.searchParams.get("event_type")).toBe("ft_transfer");
		expect(url.searchParams.get("cursor")).toBe("1:0");

		await sl.index.events.list({ eventType: "print" });
		expect(new URL(requests[1]?.url ?? "").searchParams.get("event_type")).toBe(
			"print",
		);
	});

	test("SecondLayer constructs with zero args (anonymous, default base URL)", async () => {
		const requests = captureFetch(EMPTY_EVENTS);
		const sl = new SecondLayer();

		await sl.index.ftTransfers();
		const request = requests[0];
		expect(request?.url.startsWith("https://api.secondlayer.tools/")).toBe(
			true,
		);
		expect(request?.headers.get("Authorization")).toBeNull();
	});
});
