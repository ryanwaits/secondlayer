import { describe, expect, it } from "bun:test";
import { Cl } from "../../../clarity/index.ts";
import { serializeCVBytes } from "../../../clarity/serialize.ts";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
import { bytesToHex, with0x } from "../../../utils/encoding.ts";
import { getDataVar } from "../getDataVar.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

function capturingClient(resp: unknown): {
	client: Client;
	paths: string[];
} {
	const paths: string[] = [];
	const client = {
		request: async (path: string) => {
			paths.push(path);
			return resp;
		},
	} as unknown as Client;
	return { client, paths };
}

describe("getDataVar", () => {
	it("deserializes the returned Clarity value", async () => {
		const hex = with0x(bytesToHex(serializeCVBytes(Cl.bool(true))));
		const client = mockClient({ data: hex });
		const result = await getDataVar(client, {
			contract: "SP123.foo",
			varName: "rewards-paused",
		});
		expect(result).toEqual(Cl.bool(true));
	});

	it("throws MalformedResponseError when data is missing", async () => {
		const client = mockClient({});
		await expect(
			getDataVar(client, {
				contract: "SP123.foo",
				varName: "bond-admin",
			}),
		).rejects.toThrow(MalformedResponseError);
	});

	it("requests GET /v2/data_var/.../bond-admin?proof=0", async () => {
		const hex = with0x(bytesToHex(serializeCVBytes(Cl.bool(true))));
		const { client, paths } = capturingClient({ data: hex });
		await getDataVar(client, {
			contract: "SP123.pox-5",
			varName: "bond-admin",
		});
		expect(paths).toEqual(["/v2/data_var/SP123/pox-5/bond-admin?proof=0"]);
	});
});
