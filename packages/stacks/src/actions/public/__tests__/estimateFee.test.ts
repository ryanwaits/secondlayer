import { describe, expect, it } from "bun:test";
import { Cl } from "../../../clarity/values.ts";
import type { Client } from "../../../clients/types.ts";
import { MalformedResponseError } from "../../../errors/response.ts";
import {
	AddressHashMode,
	AnchorMode,
	AuthType,
	PayloadType,
	PostConditionModeWire,
} from "../../../transactions/types.ts";
import type {
	StacksTransaction,
	TokenTransferPayload,
} from "../../../transactions/types.ts";
import { estimateFee } from "../estimateFee.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

const TEST_SIGNER = "a46ff88886c2ef9762d970b4d2c63678835b93cc";

function makeTx(): StacksTransaction {
	const payload: TokenTransferPayload = {
		payloadType: PayloadType.TokenTransfer,
		recipient: Cl.principal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"),
		amount: 1000000n,
		memo: "",
	};
	return {
		version: 0x00,
		chainId: 0x00000001,
		auth: {
			authType: AuthType.Standard,
			spendingCondition: {
				hashMode: AddressHashMode.P2PKH,
				signer: TEST_SIGNER,
				nonce: 0n,
				fee: 0n,
				keyEncoding: 0x00,
				signature: "00".repeat(65),
			},
		},
		anchorMode: AnchorMode.Any,
		postConditionMode: PostConditionModeWire.Deny,
		postConditions: [],
		payload,
	};
}

describe("estimateFee", () => {
	it("parses three valid estimations", async () => {
		const result = await estimateFee(
			mockClient({
				estimations: [
					{ fee_rate: 1, fee: 100 },
					{ fee_rate: 2, fee: 200 },
					{ fee_rate: 3, fee: 300 },
				],
			}),
			{ transaction: makeTx() },
		);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ feeRate: 1, fee: 100 });
		expect(result[1]).toEqual({ feeRate: 2, fee: 200 });
		expect(result[2]).toEqual({ feeRate: 3, fee: 300 });
	});

	it("parses a single valid estimation", async () => {
		const result = await estimateFee(
			mockClient({ estimations: [{ fee_rate: 5, fee: 500 }] }),
			{ transaction: makeTx() },
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ feeRate: 5, fee: 500 });
	});

	it("throws MalformedResponseError when fee_rate is missing", async () => {
		await expect(
			estimateFee(mockClient({ estimations: [{ fee: 100 }] }), {
				transaction: makeTx(),
			}),
		).rejects.toThrow(MalformedResponseError);
	});

	it("throws MalformedResponseError when fee is missing", async () => {
		await expect(
			estimateFee(mockClient({ estimations: [{ fee_rate: 1 }] }), {
				transaction: makeTx(),
			}),
		).rejects.toThrow(MalformedResponseError);
	});

	it("returns empty array when estimations is null", async () => {
		const result = await estimateFee(mockClient({ estimations: null }), {
			transaction: makeTx(),
		});
		expect(result).toEqual([]);
	});

	it("returns empty array when estimations is undefined", async () => {
		const result = await estimateFee(mockClient({}), { transaction: makeTx() });
		expect(result).toEqual([]);
	});
});
