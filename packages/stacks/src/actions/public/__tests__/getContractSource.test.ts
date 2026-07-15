import { describe, expect, it } from "bun:test";
import type { Client } from "../../../clients/types.ts";
import { getContractSource } from "../getContractSource.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

describe("getContractSource", () => {
	it("returns the parsed source response", async () => {
		const resp = { source: "(define-public ...)", publish_height: 100 };
		expect(
			await getContractSource(mockClient(resp), { contract: "SP123.foo" }),
		).toEqual(resp);
	});

	it("returns null when the source field is absent", async () => {
		expect(
			await getContractSource(mockClient({}), { contract: "SP123.foo" }),
		).toBeNull();
	});

	it("returns null when the response is undefined", async () => {
		expect(
			await getContractSource(mockClient(undefined), { contract: "SP123.foo" }),
		).toBeNull();
	});
});
