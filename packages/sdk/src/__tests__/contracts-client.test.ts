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

describe("SecondLayer root client wiring", () => {
	test("exposes datasets and contracts clients", () => {
		const sl = new SecondLayer();
		expect(typeof sl.datasets.listDatasets).toBe("function");
		expect(typeof sl.contracts.list).toBe("function");
	});
});

describe("Contracts client", () => {
	test("requires trait and passes optional params as query keys", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({
				contracts: [
					{
						contract_id: "SP1.token",
						deployer: "SP1",
						block_height: 100,
						declared_traits: ["sip-010"],
						inferred_standards: ["sip-010"],
						abi_status: "ready",
					},
				],
				next_cursor: null,
			});
		}) as typeof fetch;

		const sl = new SecondLayer({ apiKey: "sk-test" });
		const res = await sl.contracts.list({
			trait: "sip-010",
			conformance: "inferred",
			include: "abi",
			limit: 50,
			cursor: "SP0.prev",
		});

		expect(res.contracts).toHaveLength(1);
		expect(res.next_cursor).toBeNull();

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/contracts");
		expect(url.searchParams.get("trait")).toBe("sip-010");
		expect(url.searchParams.get("conformance")).toBe("inferred");
		expect(url.searchParams.get("include")).toBe("abi");
		expect(url.searchParams.get("limit")).toBe("50");
		expect(url.searchParams.get("cursor")).toBe("SP0.prev");
	});

	test("omits unset optional params from the query string", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({ contracts: [], next_cursor: null });
		}) as typeof fetch;

		const sl = new SecondLayer();
		await sl.contracts.list({ trait: "sip-009" });

		const url = new URL(requests[0]?.url ?? "");
		expect(url.searchParams.get("trait")).toBe("sip-009");
		expect(url.searchParams.has("conformance")).toBe(false);
		expect(url.searchParams.has("limit")).toBe(false);
	});
});
