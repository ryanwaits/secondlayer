import { describe, expect, it } from "bun:test";
import { mainnet } from "../../chains/definitions.ts";
import { Cl } from "../../clarity/index.ts";
import { serializeTransaction } from "../../transactions/wire/serialize.ts";
import { custom } from "../../transports/custom.ts";
import { createMultiSigClient } from "../createMultiSigClient.ts";

const SIGNERS = [
	"03b3e0a76b292b2c83fc0ac14ae6160d0438ebe94e14bbb5b7755153628886e08e",
	"02d0b3a1c7a0f6c2b0e1d3a4f5b6c7d8e9fa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d",
];

const client = createMultiSigClient({
	chain: mainnet,
	transport: custom({
		request: async (path: string) => {
			if (path.includes("/v2/accounts/")) return { nonce: 3 };
			throw new Error(`unexpected path ${path}`);
		},
	}),
	signers: SIGNERS,
	requiredSignatures: 2,
});

const CALL = {
	contract: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.token",
	functionName: "transfer",
	fee: 200n,
	nonce: 3n,
};

describe("multisig callContract args", () => {
	it("args and the deprecated functionArgs build the same transaction", async () => {
		const withArgs = await client.callContract({ ...CALL, args: [Cl.uint(1)] });
		const withFunctionArgs = await client.callContract({
			...CALL,
			functionArgs: [Cl.uint(1)],
		});
		expect(serializeTransaction(withArgs)).toEqual(
			serializeTransaction(withFunctionArgs),
		);
	});

	it("rejects args and functionArgs that differ", async () => {
		await expect(
			client.callContract({
				...CALL,
				args: [Cl.uint(1)],
				functionArgs: [Cl.uint(2)],
			}),
		).rejects.toThrow("Pass args or functionArgs, not both");
	});
});
