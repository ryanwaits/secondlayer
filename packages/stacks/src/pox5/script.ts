import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import { BITCOIN_NETWORK_PARAMS } from "../bitcoin/address.ts";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import { serializeCVBytes } from "../clarity/serialize.ts";
import { Cl } from "../clarity/values.ts";
import { concatBytes, hexToBytes } from "../utils/encoding.ts";
import { BITCOIN_LOCKTIME_THRESHOLD, C_SCRIPT_NUM_MAX } from "./constants.ts";

/**
 * Byte-for-byte TypeScript mirrors of pox-5's Bitcoin-script helpers
 * (`serialize-c-script-num`, `push-c-script-num`, `push-script-bytes`,
 * `construct-lockup-script`, `construct-lockup-output-script`), pinned
 * against the final contract in stacks-core 4.0.1. The contract validates a
 * staker's L1 lockup output against exactly these bytes, so any divergence
 * means a rejected registration — the read-onlys on-chain double as a
 * cross-check oracle for these functions.
 */

/**
 * Minimal little-endian ScriptNum encoding of a non-negative integer
 * (`0` → empty; a `0x00` sign byte is appended when the top byte's high bit
 * is set). Mirrors `serialize-c-script-num`, including its 2^39 ceiling.
 */
export function serializeCScriptNum(n: number | bigint): Uint8Array {
	const big = typeof n === "bigint" ? n : BigInt(n);
	if (big < 0n) throw new Error("serializeCScriptNum: negative value");
	if (big >= C_SCRIPT_NUM_MAX) {
		throw new Error(
			"serializeCScriptNum: n >= 2^39 (contract rejects with ERR_INVALID_UNLOCK_HEIGHT)",
		);
	}
	if (big === 0n) return new Uint8Array(0);
	const out: number[] = [];
	let v = big;
	while (v > 0n) {
		out.push(Number(v & 0xffn));
		v >>= 8n;
	}
	if ((out[out.length - 1] as number) & 0x80) out.push(0x00);
	return Uint8Array.from(out);
}

/**
 * Push arbitrary bytes onto a Bitcoin script: direct length byte under 76,
 * `OP_PUSHDATA1` under 256, `OP_PUSHDATA2` otherwise. Mirrors
 * `push-script-bytes`.
 */
export function pushScriptBytes(bytes: Uint8Array): Uint8Array {
	const len = bytes.length;
	if (len > 0xffff)
		throw new Error(`pushScriptBytes: payload too large (${len} > 65535)`);
	let prefix: Uint8Array;
	if (len < 76) prefix = Uint8Array.of(len);
	else if (len < 256) prefix = Uint8Array.of(0x4c, len);
	else prefix = Uint8Array.of(0x4d, len & 0xff, len >> 8);
	return concatBytes(prefix, bytes);
}

/**
 * Push a numeric script value: `OP_0` for zero, the single-byte ops
 * `OP_1`..`OP_16` for 1–16, else a minimal ScriptNum push. Mirrors
 * `push-c-script-num`.
 */
export function pushCScriptNum(n: number | bigint): Uint8Array {
	const big = typeof n === "bigint" ? n : BigInt(n);
	if (big === 0n) return Uint8Array.of(0x00);
	if (big >= 1n && big <= 16n) return Uint8Array.of(0x50 + Number(big));
	return pushScriptBytes(serializeCScriptNum(big));
}

/** `to-consensus-buff?` of a principal — the staker identity the script commits to. */
export function stakerConsensusBuff(stxAddress: string): Uint8Array {
	return serializeCVBytes(Cl.principal(stxAddress));
}

/**
 * The 32-byte witness item the early-exit branch must reveal:
 * `sha256(to-consensus-buff? staker)`. The script stores `sha256` of THIS,
 * so revealing it proves which staker the exit is for.
 */
export function stakerPreimage(stxAddress: string): Uint8Array {
	return sha256(stakerConsensusBuff(stxAddress));
}

export type BuildLockupScriptOptions = {
	/** Staker principal (standard or contract address). */
	stxAddress: string;
	/** Burn height at which the CLTV branch becomes spendable. */
	unlockBurnHeight: number | bigint;
	/** Staker-signature subscript, run last in BOTH branches. */
	stakerUnlockBytes: Uint8Array | string;
	/** Per-bond early-unlock subscript (from `protocol-bonds.early-unlock-bytes`). */
	earlyUnlockBytes: Uint8Array | string;
};

function toBytes(input: Uint8Array | string): Uint8Array {
	return typeof input === "string" ? hexToBytes(input) : input;
}

/**
 * The L1 lockup witness script. Mirrors `construct-lockup-script`:
 *
 * ```
 * OP_IF
 *   <unlockBurnHeight> OP_CHECKLOCKTIMEVERIFY
 * OP_ELSE
 *   OP_SIZE <32> OP_EQUALVERIFY OP_SHA256
 *   <sha256(sha256(consensus-buff(staker)))> OP_EQUALVERIFY
 *   <earlyUnlockBytes>
 * OP_ENDIF
 * OP_VERIFY
 * <stakerUnlockBytes>
 * ```
 */
export function buildLockupScript(opts: BuildLockupScriptOptions): Uint8Array {
	const height = BigInt(opts.unlockBurnHeight);
	if (height >= BITCOIN_LOCKTIME_THRESHOLD) {
		throw new Error(
			"unlockBurnHeight >= 500,000,000 would be read by Bitcoin as a timestamp (contract rejects it)",
		);
	}
	const stakerHash = sha256(stakerPreimage(opts.stxAddress));
	return concatBytes(
		Uint8Array.of(0x63), // OP_IF
		pushCScriptNum(height),
		Uint8Array.of(0xb1, 0x67), // OP_CHECKLOCKTIMEVERIFY, OP_ELSE
		// OP_SIZE, <0x20>, OP_EQUALVERIFY, OP_SHA256, OP_PUSHBYTES_32
		hexToBytes("82012088a820"),
		stakerHash,
		Uint8Array.of(0x88), // OP_EQUALVERIFY
		toBytes(opts.earlyUnlockBytes),
		Uint8Array.of(0x68, 0x69), // OP_ENDIF, OP_VERIFY
		toBytes(opts.stakerUnlockBytes),
	);
}

/**
 * P2WSH `scriptPubKey` for a lockup script: `0x0020 || sha256(script)`.
 * Mirrors `construct-lockup-output-script`.
 */
export function buildLockupOutputScript(
	opts: BuildLockupScriptOptions,
): Uint8Array {
	return concatBytes(
		Uint8Array.of(0x00, 0x20),
		sha256(buildLockupScript(opts)),
	);
}

/** The bech32 P2WSH address a staker sends their L1 BTC lockup to. */
export function buildLockupAddress(
	opts: BuildLockupScriptOptions,
	network: BitcoinNetwork = "mainnet",
): string {
	const hash = sha256(buildLockupScript(opts));
	return bech32.encode(BITCOIN_NETWORK_PARAMS[network].hrp, [
		0,
		...bech32.toWords(hash),
	]);
}

/**
 * The default staker subscript: `<pubkey> OP_CHECKSIG` — spendable by one
 * key. Any script tail is valid as far as the contract is concerned; this is
 * the common case.
 */
export function buildDefaultStakerUnlockBytes(
	publicKey: Uint8Array | string,
): Uint8Array {
	const pubkey = toBytes(publicKey);
	if (pubkey.length !== 33)
		throw new Error(`Expected 33-byte compressed pubkey, got ${pubkey.length}`);
	return concatBytes(pushScriptBytes(pubkey), Uint8Array.of(0xac)); // OP_CHECKSIG
}
