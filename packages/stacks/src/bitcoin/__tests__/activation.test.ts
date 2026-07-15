import { describe, expect, it } from "bun:test";
import type { Client } from "../../clients/types.ts";
import { MalformedResponseError } from "../../errors/response.ts";
import { getBurnBlockHeight, isClarity6Active } from "../activation.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getBurnBlockHeight", () => {
	it("returns burn_block_height", async () => {
		expect(
			await getBurnBlockHeight(mockClient({ burn_block_height: 900 })),
		).toBe(900);
	});

	it("throws MalformedResponseError when burn_block_height is missing", async () => {
		await expect(getBurnBlockHeight(mockClient({}))).rejects.toThrow(
			MalformedResponseError,
		);
	});
});

describe("isClarity6Active", () => {
	it("throws when activationBurnHeight is not supplied", async () => {
		await expect(
			isClarity6Active(mockClient({ burn_block_height: 900 })),
		).rejects.toThrow(/activation burn height is not yet known/);
	});

	it("compares current burn height to the activation height", async () => {
		const client = mockClient({ burn_block_height: 900 });
		expect(await isClarity6Active(client, { activationBurnHeight: 900 })).toBe(
			true,
		);
		expect(await isClarity6Active(client, { activationBurnHeight: 901 })).toBe(
			false,
		);
	});
});
