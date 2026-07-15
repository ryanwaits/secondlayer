import { describe, expect, it } from "bun:test";
import { mainnet } from "../../chains/index.ts";
import { Cl } from "../../clarity/index.ts";
import { serializeCVBytes } from "../../clarity/serialize.ts";
import { createPublicClient } from "../../clients/createPublicClient.ts";
import type { Client } from "../../clients/types.ts";
import { custom } from "../../transports/custom.ts";
import { bytesToHex, with0x } from "../../utils/encoding.ts";
import { canRegister, getZonefile } from "../actions.ts";

const ERR_RESULT_HEX = with0x(
	bytesToHex(serializeCVBytes(Cl.error(Cl.uint(101)))),
);

function clientRespondingWith(result: unknown): Client {
	const request = async (path: string) => {
		if (path.includes("/v2/contracts/call-read/")) return result;
		throw new Error(`unexpected path ${path}`);
	};
	return createPublicClient({
		chain: mainnet,
		transport: custom({ request }),
	}) as unknown as Client;
}

function clientThrowingOnRead(error: Error): Client {
	const request = async () => {
		throw error;
	};
	return createPublicClient({
		chain: mainnet,
		transport: custom({ request }),
	}) as unknown as Client;
}

describe("canRegister", () => {
	it("returns true when the contract call errors (name unknown)", async () => {
		const client = clientRespondingWith({ okay: true, result: ERR_RESULT_HEX });
		expect(await canRegister(client, "alice.btc")).toBe(true);
	});

	it("propagates a network/transport failure instead of returning true", async () => {
		const client = clientThrowingOnRead(new Error("network down"));
		await expect(canRegister(client, "alice.btc")).rejects.toThrow(
			"network down",
		);
	});
});

describe("getZonefile", () => {
	it("returns null when the contract call errors (no zonefile set)", async () => {
		const client = clientRespondingWith({ okay: true, result: ERR_RESULT_HEX });
		expect(await getZonefile(client, "alice.btc")).toBeNull();
	});

	it("propagates a network/transport failure instead of returning null", async () => {
		const client = clientThrowingOnRead(new Error("network down"));
		await expect(getZonefile(client, "alice.btc")).rejects.toThrow(
			"network down",
		);
	});
});
