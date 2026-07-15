import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { getNftHoldings } from "../getNftHoldings.ts";

function mockClient(handler: (path: string) => unknown): Client {
	return {
		request: async (path: string) => handler(path),
	} as unknown as Client;
}

describe("getNftHoldings", () => {
	it("requests the nft holdings endpoint with a default limit", async () => {
		let seenPath = "";
		const client = mockClient((path) => {
			seenPath = path;
			return { results: [], total: 0 };
		});
		await getNftHoldings(client, { address: "SP123" });
		expect(seenPath).toBe(
			"/extended/v1/tokens/nft/holdings?principal=SP123&limit=20",
		);
	});

	it("caps the limit at 50", async () => {
		let seenPath = "";
		const client = mockClient((path) => {
			seenPath = path;
			return { results: [], total: 0 };
		});
		await getNftHoldings(client, { address: "SP123", limit: 500 });
		expect(seenPath).toBe(
			"/extended/v1/tokens/nft/holdings?principal=SP123&limit=50",
		);
	});

	it("returns the response body", async () => {
		const resp = { results: [{ asset_identifier: "SP1.foo::bar" }], total: 1 };
		const client = mockClient(() => resp);
		expect(await getNftHoldings(client, { address: "SP123" })).toEqual(resp);
	});
});
