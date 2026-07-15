import { describe, expect, it } from "bun:test";
import { Cl } from "../../../clarity/index.ts";
import { serializeCVBytes } from "../../../clarity/serialize.ts";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
import { bytesToHex, with0x } from "../../../utils/encoding.ts";
import { getMapEntry } from "../getMapEntry.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getMapEntry", () => {
	it("deserializes the returned Clarity value", async () => {
		const hex = with0x(bytesToHex(serializeCVBytes(Cl.uint(7))));
		const client = mockClient({ data: hex });
		const result = await getMapEntry(client, {
			contract: "SP123.foo",
			mapName: "balances",
			key: Cl.uint(1),
		});
		expect(result).toEqual(Cl.uint(7));
	});

	it("throws MalformedResponseError when data is missing", async () => {
		const client = mockClient({});
		await expect(
			getMapEntry(client, {
				contract: "SP123.foo",
				mapName: "balances",
				key: Cl.uint(1),
			}),
		).rejects.toThrow(MalformedResponseError);
	});
});
