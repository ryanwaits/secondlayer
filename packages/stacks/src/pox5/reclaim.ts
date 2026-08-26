import { sha256 } from "@noble/hashes/sha2.js";
import * as btc from "@scure/btc-signer";
import { signECDSA } from "@scure/btc-signer/utils.js";
import type { BitcoinNetwork } from "../bitcoin/constants.ts";
import {
	type IntegerType,
	bytesToHex,
	concatBytes,
	hexToBytes,
	intToBigInt,
} from "../utils/encoding.ts";
import { stakerPreimage } from "./script.ts";

/**
 * Spend a pox-5 P2WSH lockup back out.
 *
 * Two paths through the lockup script (mirror of `construct-lockup-script`):
 * - `'locktime'` — CLTV exit (`OP_IF`), single-sig, spendable once the burn
 *   height is past the lock's unlock height.
 * - `'early-exit'` — cosigned exit (`OP_ELSE`), 2-of-2 staker + bond cosigner.
 *   Valid only after `announce-l1-early-exit` on Stacks; this helper spends the
 *   UTXO and does not announce.
 */
export type ReclaimPath = "locktime" | "early-exit";

const SIGHASH_ALL = 1;
/** Conservative dust limit (the 546-sat P2PKH bound covers all output types). */
const DUST_LIMIT_SATS = 546n;
/** Empty witness item — selects the `OP_ELSE` (early-exit) branch. */
const ELSE_SELECTOR = new Uint8Array(0);
/** Truthy witness item — selects the `OP_IF` (CLTV) branch. */
const IF_SELECTOR = new Uint8Array([0x01]);
/** Custom-script spend; let btc-signer carry it unvalidated. */
const TX_OPTS = {
	allowUnknownOutputs: true,
	disableScriptCheck: true,
	allowUnknownInputs: true,
} as const;

const REGTEST_NETWORK = { ...btc.TEST_NETWORK, bech32: "bcrt" };

function btcNetworkFrom(network: BitcoinNetwork): typeof btc.NETWORK {
	if (network === "mainnet") return btc.NETWORK;
	if (network === "testnet") return btc.TEST_NETWORK;
	return REGTEST_NETWORK;
}

function toBytes(value: Uint8Array | string): Uint8Array {
	return typeof value === "string" ? hexToBytes(value) : value;
}

function toPrivBytes(value: Uint8Array | string): Uint8Array {
	return toBytes(value).slice(0, 32);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	return bytesToHex(a) === bytesToHex(b);
}

/** P2WSH `scriptPubKey`: `0x0020 || sha256(lockScript)`. */
function scriptToWshOutput(lockScript: Uint8Array): Uint8Array {
	return concatBytes(Uint8Array.of(0x00, 0x20), sha256(lockScript));
}

/** Ops in the fixed lockup scaffold before the early-unlock subscript. */
const SCAFFOLD_PREFIX_LEN = 10;

/**
 * Split a lockup witness script on the `construct-lockup-script` scaffold so
 * each subscript's keys stay attributed to the right party. Locate
 * `OP_ENDIF OP_VERIFY` from the end — a subscript may contain conditionals of
 * its own.
 *
 * @throws if the script is not a pox-5 lockup script.
 */
function decodeLockScript(script: Uint8Array): {
	stakerPubs: Uint8Array[];
	cosignerPubs: Uint8Array[];
	unlockHeight?: number;
} {
	const ops = btc.Script.decode(script);

	const endifIdx = ops.reduce<number>(
		(found, op, i) => (op === "ENDIF" && ops[i + 1] === "VERIFY" ? i : found),
		-1,
	);

	const hashOp = ops[8];
	const shapeOk =
		endifIdx >= SCAFFOLD_PREFIX_LEN &&
		ops[0] === "IF" &&
		ops[2] === "CHECKLOCKTIMEVERIFY" &&
		ops[3] === "ELSE" &&
		ops[4] === "SIZE" &&
		ops[6] === "EQUALVERIFY" &&
		ops[7] === "SHA256" &&
		hashOp instanceof Uint8Array &&
		hashOp.length === 32 &&
		ops[9] === "EQUALVERIFY";
	if (!shapeOk) {
		throw new Error(
			"reclaim: lockScript is not a pox-5 lockup script (expected the OP_IF/OP_ELSE … OP_ENDIF OP_VERIFY scaffold)",
		);
	}

	const keysIn = (slice: btc.ScriptType) =>
		slice.filter(
			(op): op is Uint8Array => op instanceof Uint8Array && op.length === 33,
		);

	const heightOp = ops[1];
	const unlockHeight =
		typeof heightOp === "number"
			? heightOp
			: heightOp instanceof Uint8Array
				? Number(btc.ScriptNum().decode(heightOp))
				: undefined;

	return {
		cosignerPubs: keysIn(ops.slice(SCAFFOLD_PREFIX_LEN, endifIdx)),
		stakerPubs: keysIn(ops.slice(endifIdx + 2)),
		unlockHeight,
	};
}

/** Confirmed lockup UTXO (esplora / mempool.space shape). */
export type ReclaimUtxo = {
	txid: string;
	vout: number;
	value: IntegerType;
	/** Cross-check only; re-derived from `lockScript` when omitted. */
	scriptPubKey?: Uint8Array;
};

/** Inputs to {@link buildReclaim}. */
export type BuildReclaimOpts = {
	path: ReclaimPath;
	utxo: ReclaimUtxo;
	network: BitcoinNetwork;
	/**
	 * Sweep output: `value - feeSats` pays `address`. Mutate the returned tx's
	 * outputs before signing if needed (`SIGHASH_ALL` commits to them).
	 */
	output: { address: string; feeSats: IntegerType };
	/**
	 * The lockup `witnessScript` — pass the bytes you funded (typically
	 * `buildLockupScript(...)` / `RegisterMetadata.lockScript`). The CLTV
	 * unlock height is decoded from it.
	 */
	lockScript: Uint8Array | string;
};

/**
 * Build the unsigned reclaim transaction (a `@scure/btc-signer` `Transaction`).
 *
 * One P2WSH input with `witnessUtxo` + `witnessScript` so the tx is a complete
 * PSBT (`toPSBT` / `fromPSBT` round-trip). HSM path: `buildReclaim` →
 * `tx.signIdx` or {@link computeReclaimSighash} + detached `partialSig` →
 * {@link finalizeReclaim}.
 *
 * - `path: "early-exit"` → `sequence = 0xffffffff`, `lockTime = 0`
 * - `path: "locktime"` → `sequence = 0xfffffffe`, `lockTime = unlockHeight`
 */
export function buildReclaim(opts: BuildReclaimOpts): btc.Transaction {
	const network = btcNetworkFrom(opts.network);
	const lockScript = toBytes(opts.lockScript);
	const { unlockHeight: scriptHeight } = decodeLockScript(lockScript);

	const amount = intToBigInt(opts.utxo.value);
	const { address } = opts.output;
	const feeSats = intToBigInt(opts.output.feeSats);

	if (feeSats < 0n) {
		throw new Error(`buildReclaim: feeSats (${feeSats}) must be non-negative`);
	}

	const outputScript = scriptToWshOutput(lockScript);
	if (
		opts.utxo.scriptPubKey &&
		!bytesEqual(opts.utxo.scriptPubKey, outputScript)
	) {
		throw new Error(
			"buildReclaim: utxo.scriptPubKey does not match the lockScript — the signature would commit to the wrong output and every reclaim attempt would fail at relay",
		);
	}

	const sweepSats = amount - feeSats;
	if (sweepSats <= 0n) {
		throw new Error(`buildReclaim: fee (${feeSats}) >= utxo value (${amount})`);
	}
	if (sweepSats < DUST_LIMIT_SATS) {
		throw new Error(
			`buildReclaim: sweep of ${sweepSats} sats is below the ${DUST_LIMIT_SATS}-sat dust limit — nodes would not relay the tx`,
		);
	}

	const earlyExit = opts.path === "early-exit";
	if (!earlyExit && scriptHeight == null) {
		throw new Error(
			"buildReclaim: the locktime path needs a lockScript that encodes a CLTV unlock height",
		);
	}
	const lockTime = earlyExit ? 0 : scriptHeight;

	const tx = new btc.Transaction({ ...TX_OPTS, lockTime });
	tx.addInput({
		txid: opts.utxo.txid,
		index: opts.utxo.vout,
		sequence: earlyExit ? 0xffffffff : 0xfffffffe,
		witnessUtxo: { script: outputScript, amount },
		witnessScript: lockScript,
	});
	tx.addOutputAddress(address, sweepSats, network);
	return tx;
}

/**
 * Input-0 BIP-143 sighash for a reclaim tx.
 *
 * In-process keys should prefer `tx.signIdx(privateKey, 0)`. This helper is
 * for HSMs / MPC that sign a bare digest, and for passing the early-exit
 * sighash between parties. Recompute after any output/fee change.
 *
 * Reads `witnessScript` + amount off the tx (set by {@link buildReclaim});
 * pass `opts` to re-supply them for a tx parsed from raw hex.
 */
export function computeReclaimSighash(
	tx: btc.Transaction,
	opts?: { witnessScript?: Uint8Array | string; amountSats?: IntegerType },
): Uint8Array {
	const input = tx.getInput(0);
	const witnessScript =
		opts?.witnessScript != null
			? toBytes(opts.witnessScript)
			: input.witnessScript;
	const amount =
		opts?.amountSats != null
			? intToBigInt(opts.amountSats)
			: input.witnessUtxo?.amount;
	if (!witnessScript || amount == null) {
		throw new Error(
			"computeReclaimSighash: need witnessScript + amount (pass `opts` for a raw-hex tx)",
		);
	}
	return tx.preimageWitnessV0(0, witnessScript, SIGHASH_ALL, amount);
}

/**
 * Sign a reclaim sighash with a software key: DER + trailing `SIGHASH_ALL`.
 * `lowR` defaults to `false` to match btc-signer's `signIdx`. Kept as the
 * software stand-in for a detached signer (HSM tests).
 */
export function signReclaim(
	sighash: Uint8Array,
	privateKey: Uint8Array | string,
	opts?: { lowR?: boolean },
): Uint8Array {
	const priv = toPrivBytes(privateKey);
	return concatBytes(
		signECDSA(sighash, priv, opts?.lowR ?? false),
		Uint8Array.of(SIGHASH_ALL),
	);
}

/** Arguments to {@link finalizeReclaim}, discriminated on the spend path. */
export type FinalizeReclaimOpts =
	| {
			path: "early-exit";
			tx: btc.Transaction;
			/** Staker principal — rebuilds the 32-byte preimage the `OP_ELSE` branch reveals. */
			stxAddress: string;
	  }
	| { path: "locktime"; tx: btc.Transaction };

/**
 * Assemble the custom IF/ELSE witness from signatures already on the tx.
 *
 * btc-signer's own finalizer cannot build this script, so we splice
 * `finalScriptWitness` directly. Does not broadcast.
 *
 * - locktime: `[stakerSig, 0x01, witnessScript]`
 * - early-exit: `[stakerSig, cosignerSig, preimage, <empty>, witnessScript]`
 */
export function finalizeReclaim(opts: FinalizeReclaimOpts): {
	txHex: string;
	txid: string;
} {
	const { tx } = opts;
	const witnessScript = tx.getInput(0).witnessScript;
	if (!witnessScript)
		throw new Error("finalizeReclaim: input 0 has no witnessScript");

	tx.updateInput(
		0,
		{ finalScriptWitness: reclaimWitness(opts, witnessScript) },
		true,
	);
	if (!tx.isFinal)
		throw new Error("finalizeReclaim: witness injection failed (tx not final)");
	return { txHex: tx.hex, txid: tx.id };
}

function reclaimWitness(
	opts: FinalizeReclaimOpts,
	witnessScript: Uint8Array,
): Uint8Array[] {
	const sigs = opts.tx.getInput(0).partialSig ?? [];
	const { stakerPubs, cosignerPubs } = decodeLockScript(witnessScript);

	if (stakerPubs.length !== 1) {
		throw new Error(
			`finalizeReclaim: expected exactly one staker public key in the lockup script, found ${stakerPubs.length} — multi-key subscripts are not supported`,
		);
	}
	const stakerPub = stakerPubs[0];
	if (!stakerPub) {
		throw new Error(
			"finalizeReclaim: expected exactly one staker public key in the lockup script, found 0 — multi-key subscripts are not supported",
		);
	}

	const sigFor = (pub: Uint8Array) =>
		sigs.find(([p]) => p !== undefined && bytesEqual(p, pub))?.[1];

	const stakerSig = sigFor(stakerPub);
	if (!stakerSig)
		throw new Error("finalizeReclaim: missing staker signature (partialSig)");

	if (opts.path === "locktime") return [stakerSig, IF_SELECTOR, witnessScript];

	if (cosignerPubs.length !== 1) {
		throw new Error(
			`finalizeReclaim: expected exactly one cosigner public key in the lockup script, found ${cosignerPubs.length} — multi-key subscripts are not supported`,
		);
	}
	const cosignerPub = cosignerPubs[0];
	if (!cosignerPub) {
		throw new Error(
			"finalizeReclaim: expected exactly one cosigner public key in the lockup script, found 0 — multi-key subscripts are not supported",
		);
	}
	const cosignerSig = sigFor(cosignerPub);
	if (!cosignerSig)
		throw new Error("finalizeReclaim: missing cosigner signature (partialSig)");
	return [
		stakerSig,
		cosignerSig,
		stakerPreimage(opts.stxAddress),
		ELSE_SELECTOR,
		witnessScript,
	];
}

export type ReclaimOpts = BuildReclaimOpts & {
	/** 32-byte BTC private key (raw bytes or hex). Not a Stacks account key. */
	stakerPrivateKey: Uint8Array | string;
	/** Required for `path: "early-exit"`. */
	cosignerPrivateKey?: Uint8Array | string;
	/** Required for `path: "early-exit"` — feeds {@link stakerPreimage}. */
	stxAddress?: string;
};

/**
 * One-shot reclaim for in-process BTC keys: build + signIdx + finalize.
 * Does not broadcast; the caller relays `txHex`.
 */
export function reclaim(opts: ReclaimOpts): { txHex: string; txid: string } {
	const tx = buildReclaim(opts);
	tx.signIdx(toPrivBytes(opts.stakerPrivateKey), 0);
	if (opts.path === "early-exit") {
		if (opts.cosignerPrivateKey == null) {
			throw new Error(
				'reclaim: cosignerPrivateKey is required for path "early-exit"',
			);
		}
		if (opts.stxAddress == null) {
			throw new Error(
				'reclaim: stxAddress is required for path "early-exit" (preimage)',
			);
		}
		tx.signIdx(toPrivBytes(opts.cosignerPrivateKey), 0);
		return finalizeReclaim({
			path: "early-exit",
			tx,
			stxAddress: opts.stxAddress,
		});
	}
	return finalizeReclaim({ path: "locktime", tx });
}
