import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
import { getAccountInfo } from "../getAccountInfo.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getAccountInfo", () => {
	it("parses balance and nonce", async () => {
		const info = await getAccountInfo(
			mockClient({
				balance: "100",
				nonce: 7,
				balance_proof: "0xaa",
				nonce_proof: "0xbb",
			}),
			{ address: "SP..." },
		);
		expect(info).toEqual({
			balance: 100n,
			nonce: 7n,
			balanceProof: "0xaa",
			nonceProof: "0xbb",
		});
	});

	it("throws MalformedResponseError when balance is missing", async () => {
		await expect(
			getAccountInfo(mockClient({ nonce: 1 }), { address: "SP..." }),
		).rejects.toThrow(MalformedResponseError);
	});

	it("throws MalformedResponseError when nonce is missing", async () => {
		await expect(
			getAccountInfo(mockClient({ balance: "1" }), { address: "SP..." }),
		).rejects.toThrow(MalformedResponseError);
	});
});
