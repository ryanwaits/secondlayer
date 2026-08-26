import { describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import type { MerkleProof } from "../../bitcoin/merkle.ts";
import type { ProofSource, SpvProof } from "../../bitcoin/proof.ts";
import {
	bitcoinTxid,
	parseBitcoinTx,
	stripWitness,
} from "../../bitcoin/serialize.ts";
import { bytesToHex, concatBytes } from "../../utils/encoding.ts";
import { buildPox5LockProof, spvProofToL1LockupOutput } from "../lockProof.ts";

const LOCK_SCRIPT = Uint8Array.of(0x51); // dummy witness script
const OTHER_SCRIPT = Uint8Array.of(0x00);
const UNLOCK_HEIGHT = 985_430;
const HEADER = new Uint8Array(80).fill(0x11);
const HEIGHT = 800_000;
const SATS = 100_000n;

function p2wsh(lockScript: Uint8Array): Uint8Array {
	return concatBytes(Uint8Array.of(0x00, 0x20), sha256(lockScript));
}

function u32le(n: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n, true);
	return b;
}

function u64le(n: bigint): Uint8Array {
	const b = new Uint8Array(8);
	new DataView(b.buffer).setBigUint64(0, n, true);
	return b;
}

function compactSize(n: number): Uint8Array {
	if (n >= 0xfd) throw new Error("fixture compactSize only supports < 0xfd");
	return Uint8Array.of(n);
}

function encodeOutput(value: bigint, scriptPubKey: Uint8Array): Uint8Array {
	return concatBytes(
		u64le(value),
		compactSize(scriptPubKey.length),
		scriptPubKey,
	);
}

function encodeInput(): Uint8Array {
	return concatBytes(
		new Uint8Array(32),
		u32le(0),
		compactSize(0),
		u32le(0xffffffff),
	);
}

function makeTx(opts: {
	outputs: Array<{ value: bigint; scriptPubKey: Uint8Array }>;
	segwit?: boolean;
}): Uint8Array {
	const version = u32le(1);
	const inputs = concatBytes(compactSize(1), encodeInput());
	const outputs = concatBytes(
		compactSize(opts.outputs.length),
		...opts.outputs.map((o) => encodeOutput(o.value, o.scriptPubKey)),
	);
	const locktime = u32le(0);
	if (!opts.segwit) {
		return concatBytes(version, inputs, outputs, locktime);
	}
	return concatBytes(
		version,
		Uint8Array.of(0x00, 0x01),
		inputs,
		outputs,
		Uint8Array.of(0x00),
		locktime,
	);
}

function dummyMerkle(overrides: Partial<MerkleProof> = {}): MerkleProof {
	return { siblings: [], txIndex: 0, txCount: 1, ...overrides };
}

function dummyProof(
	rawTx: Uint8Array,
	extra: Partial<SpvProof> = {},
): SpvProof {
	return {
		rawTx,
		txidInternal: new Uint8Array(32),
		merkle: dummyMerkle(),
		header: HEADER,
		height: HEIGHT,
		...extra,
	};
}

describe("spvProofToL1LockupOutput", () => {
	test("strips witness and populates L1LockupOutput fields", () => {
		const scriptPubKey = p2wsh(LOCK_SCRIPT);
		const raw = makeTx({
			outputs: [{ value: SATS, scriptPubKey }],
			segwit: true,
		});
		expect(parseBitcoinTx(raw).hasWitness).toBe(true);

		const sibling = new Uint8Array(32).fill(0xaa);
		const lockup = spvProofToL1LockupOutput({
			proof: dummyProof(raw, {
				vout: 0,
				merkle: dummyMerkle({
					siblings: [sibling],
					txIndex: 0,
					txCount: 2,
				}),
			}),
			lockScript: LOCK_SCRIPT,
			unlockBurnHeight: UNLOCK_HEIGHT,
		});

		expect(parseBitcoinTx(lockup.tx as Uint8Array).hasWitness).toBe(false);
		expect(bytesToHex(lockup.tx as Uint8Array)).toBe(
			bytesToHex(stripWitness(raw)),
		);
		expect(lockup.height).toBe(HEIGHT);
		expect(lockup.outputIndex).toBe(0);
		expect(lockup.header).toBe(HEADER);
		expect(lockup.leafHashes).toEqual([sibling]);
		expect(lockup.txCount).toBe(2);
		expect(lockup.txIndex).toBe(0);
		expect(lockup.amount).toBe(SATS);
		expect(lockup.unlockBurnHeight).toBe(UNLOCK_HEIGHT);
	});

	test("throws when the output scriptPubKey does not match the lock script", () => {
		const raw = makeTx({
			outputs: [{ value: SATS, scriptPubKey: p2wsh(LOCK_SCRIPT) }],
		});
		expect(() =>
			spvProofToL1LockupOutput({
				proof: dummyProof(raw, { vout: 0 }),
				lockScript: OTHER_SCRIPT,
				unlockBurnHeight: UNLOCK_HEIGHT,
			}),
		).toThrow("lockup output script does not match");
	});

	test("throws (does not truncate) when merkle siblings exceed 14", () => {
		const raw = makeTx({
			outputs: [{ value: SATS, scriptPubKey: p2wsh(LOCK_SCRIPT) }],
		});
		const siblings = Array.from({ length: 15 }, () => new Uint8Array(32));
		expect(() =>
			spvProofToL1LockupOutput({
				proof: dummyProof(raw, {
					vout: 0,
					merkle: dummyMerkle({ siblings, txCount: 2 ** 15 }),
				}),
				lockScript: LOCK_SCRIPT,
				unlockBurnHeight: UNLOCK_HEIGHT,
			}),
		).toThrow(/15 merkle siblings.*at most 14/);
	});

	test("throws when vout is missing and two outputs match", () => {
		const scriptPubKey = p2wsh(LOCK_SCRIPT);
		const raw = makeTx({
			outputs: [
				{ value: SATS, scriptPubKey },
				{ value: SATS + 1n, scriptPubKey },
			],
		});
		expect(() =>
			spvProofToL1LockupOutput({
				proof: dummyProof(raw),
				lockScript: LOCK_SCRIPT,
				unlockBurnHeight: UNLOCK_HEIGHT,
			}),
		).toThrow(/exactly one matching lockup output, found 2/);
	});

	test("explicit vout disambiguates two matching outputs", () => {
		const scriptPubKey = p2wsh(LOCK_SCRIPT);
		const raw = makeTx({
			outputs: [
				{ value: SATS, scriptPubKey },
				{ value: SATS + 1n, scriptPubKey },
			],
		});
		const lockup = spvProofToL1LockupOutput({
			proof: dummyProof(raw),
			lockScript: LOCK_SCRIPT,
			unlockBurnHeight: UNLOCK_HEIGHT,
			vout: 1,
		});
		expect(lockup.outputIndex).toBe(1);
		expect(lockup.amount).toBe(SATS + 1n);
	});

	test("accepts 14 siblings", () => {
		const raw = makeTx({
			outputs: [{ value: SATS, scriptPubKey: p2wsh(LOCK_SCRIPT) }],
		});
		const siblings = Array.from({ length: 14 }, () => new Uint8Array(32));
		const lockup = spvProofToL1LockupOutput({
			proof: dummyProof(raw, {
				vout: 0,
				merkle: dummyMerkle({ siblings, txCount: 2 ** 14 }),
			}),
			lockScript: LOCK_SCRIPT,
			unlockBurnHeight: UNLOCK_HEIGHT,
		});
		expect(lockup.leafHashes).toHaveLength(14);
	});
});

describe("buildPox5LockProof", () => {
	test("maps a source proof onto L1LockupOutput without a network", async () => {
		const scriptPubKey = p2wsh(LOCK_SCRIPT);
		const raw = makeTx({
			outputs: [{ value: SATS, scriptPubKey }],
			segwit: true,
		});
		const parsed = parseBitcoinTx(raw);
		const header = new Uint8Array(80);
		header.set(parsed.txidInternal, 36);
		const txid = bytesToHex(bitcoinTxid(raw, { display: true }));

		const source: ProofSource = {
			async getRawTx() {
				return raw;
			},
			async getBlockForTx() {
				return {
					header,
					height: HEIGHT,
					txidsInternal: [parsed.txidInternal],
					txIndex: 0,
				};
			},
		};

		const lockup = await buildPox5LockProof({
			source,
			txid,
			lockScript: LOCK_SCRIPT,
			unlockBurnHeight: UNLOCK_HEIGHT,
			vout: 0,
		});

		expect(lockup.amount).toBe(SATS);
		expect(lockup.outputIndex).toBe(0);
		expect(lockup.txCount).toBe(1);
		expect(lockup.txIndex).toBe(0);
		expect(lockup.leafHashes).toHaveLength(0);
		expect(parseBitcoinTx(lockup.tx as Uint8Array).hasWitness).toBe(false);
		expect(lockup.height).toBe(HEIGHT);
	});
});
