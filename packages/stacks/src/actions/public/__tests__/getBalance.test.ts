import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
import { getBalance } from "../getBalance.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getBalance", () => {
	it("parses the balance", async () => {
		expect(
			await getBalance(mockClient({ balance: "100" }), { address: "SP..." }),
		).toBe(100n);
	});

	it("throws MalformedResponseError when balance is missing", async () => {
		await expect(
			getBalance(mockClient({}), { address: "SP..." }),
		).rejects.toThrow(MalformedResponseError);
	});

	it("throws MalformedResponseError when balance is null", async () => {
		await expect(
			getBalance(mockClient({ balance: null }), { address: "SP..." }),
		).rejects.toThrow(MalformedResponseError);
	});

	it("parses a numeric balance", async () => {
		expect(
			await getBalance(mockClient({ balance: 100 }), { address: "SP..." }),
		).toBe(100n);
	});
});
