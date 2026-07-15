import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { getAccountHistory } from "../getAccountHistory.ts";

function mockClient(handler: (path: string) => unknown): Client {
	return {
		request: async (path: string) => handler(path),
	} as unknown as Client;
}

describe("getAccountHistory", () => {
	it("requests the extended-v2 transactions endpoint with a default limit", async () => {
		let seenPath = "";
		const client = mockClient((path) => {
			seenPath = path;
			return { results: [], total: 0 };
		});
		await getAccountHistory(client, { address: "SP123" });
		expect(seenPath).toBe("/extended/v2/addresses/SP123/transactions?limit=20");
	});

	it("caps the limit at 50", async () => {
		let seenPath = "";
		const client = mockClient((path) => {
			seenPath = path;
			return { results: [], total: 0 };
		});
		await getAccountHistory(client, { address: "SP123", limit: 500 });
		expect(seenPath).toBe("/extended/v2/addresses/SP123/transactions?limit=50");
	});

	it("returns the response body", async () => {
		const resp = { results: [{ tx_id: "0x1" }], total: 1 };
		const client = mockClient(() => resp);
		expect(await getAccountHistory(client, { address: "SP123" })).toEqual(resp);
	});
});
