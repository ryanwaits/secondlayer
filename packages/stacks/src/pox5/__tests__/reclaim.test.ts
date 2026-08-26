import { describe, expect, test } from "bun:test";
import { getPublicKey } from "@noble/secp256k1";
import * as btc from "@scure/btc-signer";
import { bytesToHex, concatBytes, hexToBytes } from "../../utils/encoding.ts";
import {
	buildReclaim,
	computeReclaimSighash,
	finalizeReclaim,
	reclaim,
	signReclaim,
} from "../reclaim.ts";
import {
	buildDefaultStakerUnlockBytes,
	buildLockupScript,
	pushScriptBytes,
	stakerPreimage,
} from "../script.ts";

const STAKER_PRIV = hexToBytes(
	"cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df",
);
const COSIGNER_PRIV = hexToBytes(
	"5b8303150239eceaba43892af7cdd1fa7fc26eda5182ebaaa568e3341d54a4d0",
);
const STAKER_PUB = getPublicKey(STAKER_PRIV, true);
const COSIGNER_PUB = getPublicKey(COSIGNER_PRIV, true);

const STX_ADDRESS = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
const UNLOCK_HEIGHT = 850_123;
const NETWORK = "testnet" as const;

const LOCK_SCRIPT = buildLockupScript({
	stxAddress: STX_ADDRESS,
	unlockBurnHeight: UNLOCK_HEIGHT,
	stakerUnlockBytes: buildDefaultStakerUnlockBytes(STAKER_PUB),
	earlyUnlockBytes: concatBytes(
		pushScriptBytes(COSIGNER_PUB),
		Uint8Array.of(0xac),
	),
});

const UTXO = { txid: "a".repeat(64), vout: 0, value: 30_000n };
const OUTPUT_ADDRESS = btc.p2wpkh(STAKER_PUB, btc.TEST_NETWORK).address;
if (!OUTPUT_ADDRESS) throw new Error("test fixture: missing p2wpkh address");
const OUTPUT = { address: OUTPUT_ADDRESS, feeSats: 1_000n };

function witnessOf(txHex: string): Uint8Array[] {
	const decoded = btc.RawTx.decode(hexToBytes(txHex));
	const stack = decoded.witnesses?.[0];
	if (!stack) throw new Error("test: missing witness stack");
	return stack;
}

describe("buildReclaim", () => {
	test("locktime: sequence 0xfffffffe, lockTime equals unlock height", () => {
		const tx = buildReclaim({
			path: "locktime",
			utxo: UTXO,
			lockScript: LOCK_SCRIPT,
			network: NETWORK,
			output: OUTPUT,
		});
		expect(tx.lockTime).toBe(UNLOCK_HEIGHT);
		expect(tx.getInput(0).sequence).toBe(0xfffffffe);
	});

	test("early-exit: sequence 0xffffffff, lockTime 0", () => {
		const tx = buildReclaim({
			path: "early-exit",
			utxo: UTXO,
			lockScript: LOCK_SCRIPT,
			network: NETWORK,
			output: OUTPUT,
		});
		expect(tx.lockTime).toBe(0);
		expect(tx.getInput(0).sequence).toBe(0xffffffff);
	});

	test("scriptPubKey mismatch throws", () => {
		expect(() =>
			buildReclaim({
				path: "early-exit",
				utxo: { ...UTXO, scriptPubKey: new Uint8Array(34) },
				lockScript: LOCK_SCRIPT,
				network: NETWORK,
				output: OUTPUT,
			}),
		).toThrow(/does not match the lockScript/);
	});

	test("dust / fee >= value throws", () => {
		expect(() =>
			buildReclaim({
				path: "early-exit",
				utxo: UTXO,
				lockScript: LOCK_SCRIPT,
				network: NETWORK,
				output: { ...OUTPUT, feeSats: UTXO.value - 100n },
			}),
		).toThrow(/dust/);
		expect(() =>
			buildReclaim({
				path: "early-exit",
				utxo: UTXO,
				lockScript: LOCK_SCRIPT,
				network: NETWORK,
				output: { ...OUTPUT, feeSats: 30_000n },
			}),
		).toThrow(/fee/);
	});

	test("scaffold decode of buildLockupScript returns the same unlockBurnHeight", () => {
		const tx = buildReclaim({
			path: "locktime",
			utxo: UTXO,
			lockScript: LOCK_SCRIPT,
			network: NETWORK,
			output: OUTPUT,
		});
		expect(tx.lockTime).toBe(UNLOCK_HEIGHT);

		const smallHeight = 16;
		const small = buildLockupScript({
			stxAddress: STX_ADDRESS,
			unlockBurnHeight: smallHeight,
			stakerUnlockBytes: buildDefaultStakerUnlockBytes(STAKER_PUB),
			earlyUnlockBytes: concatBytes(
				pushScriptBytes(COSIGNER_PUB),
				Uint8Array.of(0xac),
			),
		});
		const smallTx = buildReclaim({
			path: "locktime",
			utxo: UTXO,
			lockScript: small,
			network: NETWORK,
			output: OUTPUT,
		});
		expect(smallTx.lockTime).toBe(smallHeight);
	});
});

describe("reclaim one-shot", () => {
	test("locktime witness is [sig, 0x01, lockScript]", () => {
		const { txHex } = reclaim({
			path: "locktime",
			utxo: UTXO,
			network: NETWORK,
			output: OUTPUT,
			lockScript: LOCK_SCRIPT,
			stakerPrivateKey: STAKER_PRIV,
		});
		const witness = witnessOf(txHex);
		expect(witness).toHaveLength(3);
		expect(bytesToHex(witness[1] ?? new Uint8Array())).toBe("01");
		expect(bytesToHex(witness[2] ?? new Uint8Array())).toBe(
			bytesToHex(LOCK_SCRIPT),
		);
		expect((witness[0] ?? new Uint8Array()).length).toBeGreaterThan(0);
	});

	test("early-exit witness is [stakerSig, cosignerSig, preimage, empty, lockScript]", () => {
		const { txHex } = reclaim({
			path: "early-exit",
			utxo: UTXO,
			network: NETWORK,
			output: OUTPUT,
			lockScript: LOCK_SCRIPT,
			stakerPrivateKey: STAKER_PRIV,
			cosignerPrivateKey: COSIGNER_PRIV,
			stxAddress: STX_ADDRESS,
		});
		const witness = witnessOf(txHex);
		expect(witness).toHaveLength(5);
		expect(bytesToHex(witness[2] ?? new Uint8Array())).toBe(
			bytesToHex(stakerPreimage(STX_ADDRESS)),
		);
		expect((witness[3] ?? new Uint8Array(1)).length).toBe(0);
		expect(bytesToHex(witness[4] ?? new Uint8Array())).toBe(
			bytesToHex(LOCK_SCRIPT),
		);
		expect((witness[0] ?? new Uint8Array()).length).toBeGreaterThan(0);
		expect((witness[1] ?? new Uint8Array()).length).toBeGreaterThan(0);
	});
});

describe("finalizeReclaim guards", () => {
	test("multi-key staker tail throws", () => {
		const multi = buildLockupScript({
			stxAddress: STX_ADDRESS,
			unlockBurnHeight: UNLOCK_HEIGHT,
			stakerUnlockBytes: concatBytes(
				pushScriptBytes(STAKER_PUB),
				pushScriptBytes(STAKER_PUB),
				Uint8Array.of(0xac),
			),
			earlyUnlockBytes: concatBytes(
				pushScriptBytes(COSIGNER_PUB),
				Uint8Array.of(0xac),
			),
		});
		const tx = buildReclaim({
			path: "locktime",
			utxo: UTXO,
			lockScript: multi,
			network: NETWORK,
			output: OUTPUT,
		});
		tx.updateInput(0, {
			partialSig: [
				[STAKER_PUB, signReclaim(computeReclaimSighash(tx), STAKER_PRIV)],
			],
		});
		expect(() => finalizeReclaim({ path: "locktime", tx })).toThrow(
			/multi-key subscripts are not supported/,
		);
	});
});

describe("computeReclaimSighash", () => {
	test("equals what tx.signIdx commits to", () => {
		const a = buildReclaim({
			path: "locktime",
			utxo: UTXO,
			lockScript: LOCK_SCRIPT,
			network: NETWORK,
			output: OUTPUT,
		});
		a.updateInput(
			0,
			{
				partialSig: [
					[STAKER_PUB, signReclaim(computeReclaimSighash(a), STAKER_PRIV)],
				],
			},
			true,
		);

		const b = buildReclaim({
			path: "locktime",
			utxo: UTXO,
			lockScript: LOCK_SCRIPT,
			network: NETWORK,
			output: OUTPUT,
		});
		b.signIdx(STAKER_PRIV, 0);

		expect(finalizeReclaim({ path: "locktime", tx: a }).txHex).toBe(
			finalizeReclaim({ path: "locktime", tx: b }).txHex,
		);
		expect(bytesToHex(computeReclaimSighash(b))).toBe(
			bytesToHex(b.preimageWitnessV0(0, LOCK_SCRIPT, 1, UTXO.value)),
		);
	});
});
