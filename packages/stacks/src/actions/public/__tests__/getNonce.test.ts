import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
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
	it("throws MalformedResponseError when nonce is missing", async () => {
		await expect(
			getNonce(mockClient({}), { address: "SP..." }),
		).rejects.toThrow(MalformedResponseError);
	});
	it("throws MalformedResponseError when nonce is null", async () => {
		await expect(
			getNonce(mockClient({ nonce: null }), { address: "SP..." }),
		).rejects.toThrow(MalformedResponseError);
	});
	it("percent-encodes the address in the path", async () => {
		const paths: string[] = [];
		const client = {
			request: async (path: string) => {
				paths.push(path);
				return { nonce: 1 };
			},
		} as unknown as Client;
		await getNonce(client, { address: "SP../admin" });
		expect(paths).toEqual([`/v2/accounts/${encodeURIComponent("SP../admin")}`]);
	});
});
