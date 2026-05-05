import { describe, expect, test } from "bun:test";
import { SecondLayer } from "../client.ts";

describe("SecondLayer root client", () => {
	test("exposes Streams, Index, and Subgraphs clients", async () => {
		const requests: Request[] = [];
		const sl = new SecondLayer({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				return new Response(
					JSON.stringify({
						block_height: 100,
						index_block_hash: "0x01",
						burn_block_height: 200,
						burn_block_hash: null,
						is_canonical: true,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});

		expect(sl.streams).toBeDefined();
		expect(sl.index.ftTransfers).toBeDefined();
		expect(sl.index.nftTransfers).toBeDefined();
		expect(sl.subgraphs).toBeDefined();

		await sl.streams.canonical(100);
		expect(new URL(requests[0]?.url ?? "").pathname).toBe(
			"/v1/streams/canonical/100",
		);
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
	});
});
