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

describe("Subgraphs operation status", () => {
	test("getOperation hits /operations/:id and returns the status", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({
				id: "op-1",
				subgraphName: "swaps",
				kind: "reindex",
				status: "running",
				fromBlock: 1,
				toBlock: 100,
				processedBlocks: 50,
				progress: 0.5,
				error: null,
				startedAt: "2026-06-04T00:00:00.000Z",
				finishedAt: null,
				createdAt: "2026-06-04T00:00:00.000Z",
				updatedAt: "2026-06-04T00:00:00.000Z",
			});
		}) as typeof fetch;

		const sl = new SecondLayer({ apiKey: "sk-test" });
		const op = await sl.subgraphs.getOperation("swaps", "op-1");

		expect(op.status).toBe("running");
		expect(op.progress).toBe(0.5);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe(
			"/api/subgraphs/swaps/operations/op-1",
		);
	});

	test("operations lists recent operations", async () => {
		const requests: Request[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			requests.push(request);
			return jsonResponse({ operations: [] });
		}) as typeof fetch;

		const sl = new SecondLayer({ apiKey: "sk-test" });
		const res = await sl.subgraphs.operations("swaps");

		expect(Array.isArray(res.operations)).toBe(true);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe(
			"/api/subgraphs/swaps/operations",
		);
	});
});
