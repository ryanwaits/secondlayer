import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
import { getBlockHeight } from "../getBlockHeight.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getBlockHeight", () => {
	it("returns stacks_tip_height", async () => {
		expect(await getBlockHeight(mockClient({ stacks_tip_height: 12345 }))).toBe(
			12345,
		);
	});

	it("throws MalformedResponseError when stacks_tip_height is missing", async () => {
		await expect(getBlockHeight(mockClient({}))).rejects.toThrow(
			MalformedResponseError,
		);
	});
});
