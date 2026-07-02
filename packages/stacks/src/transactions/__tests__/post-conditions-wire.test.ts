import { describe, expect, test } from "bun:test";
import {
	bytesToHex,
	concatBytes,
	hexToBytes,
	writeUInt8,
	writeUInt32BE,
} from "../../utils/encoding.ts";
import { buildContractCall } from "../build.ts";
import {
	AddressHashMode,
	AnchorMode,
	AuthType,
	FungibleConditionCode,
	PostConditionModeWire,
	PoxConditionCode,
	RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
	type StacksTransaction,
} from "../types.ts";
import { deserializeTransaction } from "../wire/deserialize.ts";
import { serializeTransaction } from "../wire/serialize.ts";

const ADDR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

// Reference wire encodings produced by @stacks/transactions 7.5.0
// (postConditionToWire + serializePostConditionWire), the SIP-045 reference
// codec. Body layout per SIP-045 §3.4.3:
//   staking (0x03): principal, fungible condition code, u64 amount
//   pox     (0x04): principal, pox condition code (0x30/0x31/0x32)
const STACKS_JS_VECTORS = [
	{
		name: "staking PC, standard principal, lte 500000000000",
		hex: "030216a46ff88886c2ef9762d970b4d2c63678835bd39d05000000746a528800",
		pc: {
			type: "staking" as const,
			principal: { type: "standard" as const, address: ADDR },
			conditionCode: FungibleConditionCode.LessEqual,
			amount: 500000000000n,
		},
	},
	{
		name: "staking PC, origin principal, eq 0",
		hex: "0301010000000000000000",
		pc: {
			type: "staking" as const,
			principal: { type: "origin" as const },
			conditionCode: FungibleConditionCode.Equal,
			amount: 0n,
		},
	},
	{
		name: "pox PC, standard principal, will-not-perform",
		hex: "040216a46ff88886c2ef9762d970b4d2c63678835bd39d30",
		pc: {
			type: "pox" as const,
			principal: { type: "standard" as const, address: ADDR },
			conditionCode: PoxConditionCode.WillNotPerform,
		},
	},
	{
		name: "pox PC, contract principal, may-perform",
		hex: "040316a46ff88886c2ef9762d970b4d2c63678835bd39d0e7369676e65722d6d616e6167657231",
		pc: {
			type: "pox" as const,
			principal: {
				type: "contract" as const,
				address: ADDR,
				contractName: "signer-manager",
			},
			conditionCode: PoxConditionCode.MayPerform,
		},
	},
	{
		name: "pox PC, origin principal, will-perform",
		hex: "040132",
		pc: {
			type: "pox" as const,
			principal: { type: "origin" as const },
			conditionCode: PoxConditionCode.WillPerform,
		},
	},
];

function makeStandardAuthBytes(): Uint8Array {
	return concatBytes(
		writeUInt8(AuthType.Standard),
		writeUInt8(AddressHashMode.P2PKH),
		new Uint8Array(20),
		new Uint8Array(8),
		new Uint8Array(8),
		writeUInt8(0x00),
		new Uint8Array(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES),
	);
}

// Minimal valid payload: Coinbase (0x04) + 32-byte buffer
function makeCoinbasePayloadBytes(): Uint8Array {
	return concatBytes(writeUInt8(0x04), new Uint8Array(32));
}

function wrapPostConditions(pcBytes: Uint8Array[], count?: number): Uint8Array {
	return concatBytes(
		writeUInt8(0x00), // version (mainnet)
		writeUInt32BE(0x00000001), // chain ID
		makeStandardAuthBytes(),
		writeUInt8(AnchorMode.Any),
		writeUInt8(PostConditionModeWire.Deny),
		writeUInt32BE(count ?? pcBytes.length),
		concatBytes(...pcBytes),
		makeCoinbasePayloadBytes(),
	);
}

describe("SIP-045 post-condition wire decode", () => {
	for (const vector of STACKS_JS_VECTORS) {
		test(`decodes ${vector.name} byte-identically to stacks.js 7.5.0`, () => {
			const tx = deserializeTransaction(
				wrapPostConditions([hexToBytes(vector.hex)]),
			);
			expect(tx.postConditions).toEqual([vector.pc]);
			// payload after the PCs must still parse — proves no reader misalignment
			expect(tx.payload.payloadType).toBe(0x04);
		});
	}

	test("decodes a staking PC followed by an stx PC without misaligning the reader", () => {
		// The pre-fix bug: an unrecognized asset type fell through the switch,
		// consuming nothing, so every subsequent field parsed garbage.
		const stakingHex = "0301010000000000000000";
		const stxHex =
			"000216a46ff88886c2ef9762d970b4d2c63678835bd39d0300000000000f4240";
		const tx = deserializeTransaction(
			wrapPostConditions([hexToBytes(stakingHex), hexToBytes(stxHex)]),
		);
		expect(tx.postConditions).toHaveLength(2);
		expect(tx.postConditions[0]?.type).toBe("staking");
		expect(tx.postConditions[1]).toEqual({
			type: "stx",
			principal: { type: "standard", address: ADDR },
			conditionCode: FungibleConditionCode.GreaterEqual,
			amount: 1000000n,
		});
	});

	test("throws on an unknown post-condition asset type instead of silently misaligning", () => {
		// Asset type 0x05 does not exist; body length is unknowable
		const unknownPc = concatBytes(
			writeUInt8(0x05),
			writeUInt8(0x01), // origin principal
			writeUInt8(0x01),
			new Uint8Array(8),
		);
		expect(() =>
			deserializeTransaction(wrapPostConditions([unknownPc], 1)),
		).toThrow(/Unknown post-condition asset type: 0x05/);
	});
});

describe("SIP-045 post-condition wire encode", () => {
	for (const vector of STACKS_JS_VECTORS) {
		test(`serializes ${vector.name} byte-identically to stacks.js 7.5.0`, () => {
			const tx = deserializeTransaction(
				wrapPostConditions([hexToBytes(vector.hex)]),
			);
			const roundTripped = serializeTransaction(tx);
			expect(bytesToHex(roundTripped)).toContain(vector.hex);
		});
	}

	test("round-trips a transaction carrying staking, pox, and stx post-conditions", () => {
		const tx: StacksTransaction = deserializeTransaction(
			wrapPostConditions(
				STACKS_JS_VECTORS.map((v) => hexToBytes(v.hex)).concat([
					hexToBytes(
						"000216a46ff88886c2ef9762d970b4d2c63678835bd39d0300000000000f4240",
					),
				]),
			),
		);
		expect(deserializeTransaction(serializeTransaction(tx))).toEqual(tx);
	});
});

describe("SIP-045 post-conditions in buildContractCall", () => {
	test("converts staking-postcondition and pox-postcondition to wire and round-trips", async () => {
		const tx = await buildContractCall({
			contractAddress: "SP000000000000000000002Q6VF78",
			contractName: "pox-5",
			functionName: "register-for-bond",
			functionArgs: [],
			fee: 200n,
			nonce: 1n,
			publicKey: `02${"11".repeat(32)}`,
			postConditionMode: "deny",
			postConditions: [
				{
					type: "staking-postcondition",
					address: ADDR,
					condition: "lte",
					amount: "500000000000",
				},
				{
					type: "pox-postcondition",
					address: "origin",
					condition: "will-not-perform",
				},
			],
		});
		expect(tx.postConditions).toEqual([
			{
				type: "staking",
				principal: { type: "standard", address: ADDR },
				conditionCode: FungibleConditionCode.LessEqual,
				amount: 500000000000n,
			},
			{
				type: "pox",
				principal: { type: "origin" },
				conditionCode: PoxConditionCode.WillNotPerform,
			},
		]);
		expect(deserializeTransaction(serializeTransaction(tx))).toEqual(tx);
	});
});
