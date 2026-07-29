import { describe, expect, it } from "bun:test";
import type { Client } from "../../clients/types.ts";
import { EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET } from "../../epochs.ts";
import { MalformedResponseError } from "../../errors/response.ts";
import { getBurnBlockHeight, isClarity6Active } from "../activation.ts";

function mockClient(resp: unknown, network?: string): Client {
	return {
		request: async () => resp,
		...(network ? { chain: { network } } : {}),
	} as unknown as Client;
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
	it("throws when no activation height is supplied off mainnet", async () => {
		await expect(
			isClarity6Active(mockClient({ burn_block_height: 900 }, "testnet")),
		).rejects.toThrow(/no fixed activation height on testnet/);
	});

	it("falls back to the Epoch 4.0 mainnet height on a mainnet client", async () => {
		expect(
			await isClarity6Active(
				mockClient(
					{ burn_block_height: EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET - 1 },
					"mainnet",
				),
			),
		).toBe(false);
		expect(
			await isClarity6Active(
				mockClient(
					{ burn_block_height: EPOCH_4_ACTIVATION_BURN_HEIGHT_MAINNET },
					"mainnet",
				),
			),
		).toBe(true);
	});

	it("prefers an explicit activation height over the mainnet fallback", async () => {
		expect(
			await isClarity6Active(
				mockClient({ burn_block_height: 900 }, "mainnet"),
				{
					activationBurnHeight: 900,
				},
			),
		).toBe(true);
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
