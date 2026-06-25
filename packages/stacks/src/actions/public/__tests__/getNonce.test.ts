import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { getNonce } from "../getNonce.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getNonce", () => {
	it("parses a numeric nonce", async () => {
		expect(await getNonce(mockClient({ nonce: 7 }), { address: "SP..." })).toBe(
			7n,
		);
	});
	it("parses a string nonce", async () => {
		expect(
			await getNonce(mockClient({ nonce: "7" }), { address: "SP..." }),
		).toBe(7n);
	});
	it("throws a clear error on a missing nonce", async () => {
		await expect(
			getNonce(mockClient({}), { address: "SP..." }),
		).rejects.toThrow(/getNonce:/);
	});
	it("throws a clear error on a null nonce", async () => {
		await expect(
			getNonce(mockClient({ nonce: null }), { address: "SP..." }),
		).rejects.toThrow(/getNonce:/);
	});
});
