import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { type RawBlockResponse, getRawBlock } from "../getRawBlock.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

const FULL_RESPONSE: RawBlockResponse = {
	hash: "0xabc",
	height: 100,
	parent_block_hash: "0x000",
	burn_block_height: 900,
	burn_block_hash: "0xburn",
	burn_block_time: 123,
	index_block_hash: "0xdef",
	parent_index_block_hash: "0x111",
	miner_txid: "0xminer",
	txs: [],
};

describe("getRawBlock", () => {
	it("returns the parsed raw block response", async () => {
		expect(
			await getRawBlock(mockClient(FULL_RESPONSE), { height: 100 }),
		).toEqual(FULL_RESPONSE);
	});

	it("returns null when the hash field is absent", async () => {
		expect(await getRawBlock(mockClient({}), { height: 100 })).toBeNull();
	});

	it("returns null when the response is undefined", async () => {
		expect(
			await getRawBlock(mockClient(undefined), { height: 100 }),
		).toBeNull();
	});
});
