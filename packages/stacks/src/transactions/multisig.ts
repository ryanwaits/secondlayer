import {
	getPublicKey as nobleGetPublicKey,
	sign as nobleSign,
} from "@noble/secp256k1";
import type { CustomAccount, LocalAccount } from "../accounts/types.ts";
import type { StacksChain } from "../chains/types.ts";
import { c32address } from "../utils/c32.ts";
import {
	bytesToHex,
	concatBytes,
	hexToBytes,
	intToHex,
} from "../utils/encoding.ts";
import { hash160 } from "../utils/hash.ts";
import { txidFromBytes } from "../utils/hash.ts";
import {
	intoInitialSighashAuth,
	nextSignature,
	sigHashPostSign,
	sigHashPreSign,
} from "./authorization.ts";
import {
	AddressHashMode,
	AuthType,
	type MultiSigHashMode,
	type MultiSigSpendingCondition,
	PubKeyEncoding,
	type StacksTransaction,
	type TransactionAuthField,
} from "./types.ts";
import { serializeTransaction } from "./wire/serialize.ts";

const OP_CHECKMULTISIG = 0xae;

/** Check if hash mode is non-sequential (SIP-027) */
export function isNonSequential(hashMode: number): boolean {
	return (hashMode & 0x04) !== 0;
}

function makeRedeemScript(
	publicKeys: string[],
	signaturesRequired: number,
): Uint8Array {
	const parts: Uint8Array[] = [];
	parts.push(new Uint8Array([0x50 + signaturesRequired])); // OP_n
	for (const pk of publicKeys) {
		const pkBytes = hexToBytes(pk);
		parts.push(new Uint8Array([pkBytes.length]));
		parts.push(pkBytes);
	}
	parts.push(new Uint8Array([0x50 + publicKeys.length])); // OP_m
	parts.push(new Uint8Array([OP_CHECKMULTISIG]));
	return concatBytes(...parts);
}

/** Derive a multi-sig address from public keys */
export function makeMultiSigAddress(
	publicKeys: string[],
	signaturesRequired: number,
	chain?: StacksChain,
): string {
	if (signaturesRequired < 1 || signaturesRequired > publicKeys.length) {
		throw new Error(
			`signaturesRequired must be between 1 and ${publicKeys.length}`,
		);
	}
	const redeemScript = makeRedeemScript(publicKeys, signaturesRequired);
	const signer = hash160(redeemScript);
	const version = chain?.addressVersion?.multiSig ?? 20;
	return c32address(version, bytesToHex(signer));
}

/** Create an empty multi-sig spending condition */
export function createMultiSigSpendingCondition(
	publicKeys: string[],
	signaturesRequired: number,
	nonce: bigint,
	fee: bigint,
	hashMode: MultiSigHashMode = AddressHashMode.P2SH,
): MultiSigSpendingCondition {
	const redeemScript = makeRedeemScript(publicKeys, signaturesRequired);
	const signer = bytesToHex(hash160(redeemScript));

	return {
		hashMode,
		signer,
		nonce,
		fee,
		fields: [],
		signaturesRequired,
	};
}

function initialSigHash(tx: StacksTransaction): string {
	const cleared: StacksTransaction = {
		...tx,
		auth: intoInitialSighashAuth(tx.auth),
	};
	return txidFromBytes(serializeTransaction(cleared));
}

function nonSequentialPreSignHash(tx: StacksTransaction): string {
	const condition = tx.auth.spendingCondition as MultiSigSpendingCondition;
	const initHash = initialSigHash(tx);
	return sigHashPreSign(
		initHash,
		AuthType.Standard,
		condition.fee,
		condition.nonce,
	);
}

/** Replay sighash through existing auth fields of a multi-sig tx */
export function replayMultiSigSigHash(tx: StacksTransaction): string {
	const condition = tx.auth.spendingCondition as MultiSigSpendingCondition;

	// Non-sequential: all signers sign the same presign-sighash, no field chaining
	if (isNonSequential(condition.hashMode)) {
		const preSign = nonSequentialPreSignHash(tx);
		let curSigHash = preSign;
		for (const field of condition.fields) {
			curSigHash = sigHashPostSign(
				curSigHash,
				field.pubKeyEncoding,
				field.data,
			);
		}
		return curSigHash;
	}

	let curSigHash = initialSigHash(tx);
	for (const field of condition.fields) {
		const preSign = sigHashPreSign(
			curSigHash,
			AuthType.Standard,
			condition.fee,
			condition.nonce,
		);
		curSigHash = sigHashPostSign(preSign, field.pubKeyEncoding, field.data);
	}
	return curSigHash;
}

/** Sign one position of a multi-sig transaction with a private key */
export function signMultiSig(
	tx: StacksTransaction,
	privateKey: string,
	publicKeys: string[],
): StacksTransaction {
	const keyBytes = hexToBytes(privateKey).slice(0, 32);
	const signerPubKey = bytesToHex(nobleGetPublicKey(keyBytes, true));

	const signerIndex = publicKeys.findIndex((pk) => pk === signerPubKey);
	if (signerIndex === -1) {
		throw new Error(
			"Private key does not correspond to any signer in the multi-sig",
		);
	}

	const condition = {
		...(tx.auth.spendingCondition as MultiSigSpendingCondition),
	};

	if (isNonSequential(condition.hashMode)) {
		return signNonSequential(tx, condition, privateKey);
	}

	return signSequential(tx, condition, privateKey, publicKeys, signerIndex);
}

function signNonSequential(
	tx: StacksTransaction,
	condition: MultiSigSpendingCondition,
	privateKey: string,
): StacksTransaction {
	const fields = [...condition.fields];
	const preSignHash = nonSequentialPreSignHash(tx);

	const keyBytes = hexToBytes(privateKey).slice(0, 32);
	const sig = nobleSign(preSignHash, keyBytes, { lowS: true });
	const recoveryIdHex = intToHex(sig.recovery, 1);
	const nextSig = recoveryIdHex + sig.toCompactHex();

	fields.push({
		type: "signature",
		pubKeyEncoding: PubKeyEncoding.Compressed,
		data: nextSig,
	});

	const newCondition: MultiSigSpendingCondition = { ...condition, fields };
	const sigCount = fields.filter((f) => f.type === "signature").length;

	if (sigCount >= condition.signaturesRequired) {
		return {
			...tx,
			auth: { ...tx.auth, spendingCondition: newCondition },
		};
	}

	return {
		...tx,
		auth: { ...tx.auth, spendingCondition: newCondition },
	};
}

function signSequential(
	tx: StacksTransaction,
	condition: MultiSigSpendingCondition,
	privateKey: string,
	publicKeys: string[],
	signerIndex: number,
): StacksTransaction {
	const fields = [...condition.fields];

	let curSigHash = initialSigHash(tx);
	for (const field of fields) {
		const preSign = sigHashPreSign(
			curSigHash,
			AuthType.Standard,
			condition.fee,
			condition.nonce,
		);
		curSigHash = sigHashPostSign(preSign, field.pubKeyEncoding, field.data);
	}

	for (let i = fields.length; i < signerIndex; i++) {
		const pubKeyField: TransactionAuthField = {
			type: "publicKey",
			pubKeyEncoding: PubKeyEncoding.Compressed,
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			data: publicKeys[i]!,
		};
		fields.push(pubKeyField);
		const preSign = sigHashPreSign(
			curSigHash,
			AuthType.Standard,
			condition.fee,
			condition.nonce,
		);
		curSigHash = sigHashPostSign(
			preSign,
			pubKeyField.pubKeyEncoding,
			pubKeyField.data,
		);
	}

	const { nextSig, nextSigHash } = nextSignature(
		curSigHash,
		AuthType.Standard,
		condition.fee,
		condition.nonce,
		privateKey,
	);

	fields.push({
		type: "signature",
		pubKeyEncoding: PubKeyEncoding.Compressed,
		data: nextSig,
	});
	curSigHash = nextSigHash;

	const newCondition: MultiSigSpendingCondition = { ...condition, fields };

	const sigCount = fields.filter((f) => f.type === "signature").length;
	let finalCondition = newCondition;

	if (sigCount >= condition.signaturesRequired) {
		finalCondition = finalizeMultiSigCondition(
			newCondition,
			publicKeys,
			curSigHash,
		);
	}

	return {
		...tx,
		auth: {
			...tx.auth,
			spendingCondition: finalCondition,
		},
	};
}

/** Sign one position of a multi-sig transaction with an account */
export async function signMultiSigWithAccount(
	tx: StacksTransaction,
	account: LocalAccount | CustomAccount,
	publicKeys: string[],
): Promise<StacksTransaction> {
	const signerPubKey = account.publicKey;

	const signerIndex = publicKeys.findIndex((pk) => pk === signerPubKey);
	if (signerIndex === -1) {
		throw new Error(
			"Account does not correspond to any signer in the multi-sig",
		);
	}

	const condition = {
		...(tx.auth.spendingCondition as MultiSigSpendingCondition),
	};

	if (isNonSequential(condition.hashMode)) {
		return signNonSequentialWithAccount(tx, condition, account);
	}

	return signSequentialWithAccount(
		tx,
		condition,
		account,
		publicKeys,
		signerIndex,
	);
}

async function signNonSequentialWithAccount(
	tx: StacksTransaction,
	condition: MultiSigSpendingCondition,
	account: LocalAccount | CustomAccount,
): Promise<StacksTransaction> {
	const fields = [...condition.fields];
	const preSignHash = nonSequentialPreSignHash(tx);

	const sigBytes = await account.sign(hexToBytes(preSignHash));
	const nextSig = bytesToHex(sigBytes);

	fields.push({
		type: "signature",
		pubKeyEncoding: PubKeyEncoding.Compressed,
		data: nextSig,
	});

	const newCondition: MultiSigSpendingCondition = { ...condition, fields };

	return {
		...tx,
		auth: { ...tx.auth, spendingCondition: newCondition },
	};
}

async function signSequentialWithAccount(
	tx: StacksTransaction,
	condition: MultiSigSpendingCondition,
	account: LocalAccount | CustomAccount,
	publicKeys: string[],
	signerIndex: number,
): Promise<StacksTransaction> {
	const fields = [...condition.fields];

	let curSigHash = initialSigHash(tx);
	for (const field of fields) {
		const preSign = sigHashPreSign(
			curSigHash,
			AuthType.Standard,
			condition.fee,
			condition.nonce,
		);
		curSigHash = sigHashPostSign(preSign, field.pubKeyEncoding, field.data);
	}

	for (let i = fields.length; i < signerIndex; i++) {
		const pubKeyField: TransactionAuthField = {
			type: "publicKey",
			pubKeyEncoding: PubKeyEncoding.Compressed,
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			data: publicKeys[i]!,
		};
		fields.push(pubKeyField);
		const preSign = sigHashPreSign(
			curSigHash,
			AuthType.Standard,
			condition.fee,
			condition.nonce,
		);
		curSigHash = sigHashPostSign(
			preSign,
			pubKeyField.pubKeyEncoding,
			pubKeyField.data,
		);
	}

	const preSign = sigHashPreSign(
		curSigHash,
		AuthType.Standard,
		condition.fee,
		condition.nonce,
	);
	const sigBytes = await account.sign(hexToBytes(preSign));
	const nextSig = bytesToHex(sigBytes);
	const nextSigHash = sigHashPostSign(
		preSign,
		PubKeyEncoding.Compressed,
		nextSig,
	);

	fields.push({
		type: "signature",
		pubKeyEncoding: PubKeyEncoding.Compressed,
		data: nextSig,
	});
	curSigHash = nextSigHash;

	const newCondition: MultiSigSpendingCondition = { ...condition, fields };

	const sigCount = fields.filter((f) => f.type === "signature").length;
	let finalCondition = newCondition;

	if (sigCount >= condition.signaturesRequired) {
		finalCondition = finalizeMultiSigCondition(
			newCondition,
			publicKeys,
			curSigHash,
		);
	}

	return {
		...tx,
		auth: {
			...tx.auth,
			spendingCondition: finalCondition,
		},
	};
}

/** Fill remaining slots with pubkey fields after all signatures are collected */
export function finalizeMultiSig(
	tx: StacksTransaction,
	publicKeys: string[],
): StacksTransaction {
	const condition = tx.auth.spendingCondition as MultiSigSpendingCondition;

	if (isNonSequential(condition.hashMode)) {
		return tx;
	}

	const curSigHash = replayMultiSigSigHash(tx);
	const finalCondition = finalizeMultiSigCondition(
		condition,
		publicKeys,
		curSigHash,
	);

	return {
		...tx,
		auth: {
			...tx.auth,
			spendingCondition: finalCondition,
		},
	};
}

function finalizeMultiSigCondition(
	condition: MultiSigSpendingCondition,
	publicKeys: string[],
	curSigHash: string,
): MultiSigSpendingCondition {
	const fields = [...condition.fields];
	let sigHash = curSigHash;

	for (let i = fields.length; i < publicKeys.length; i++) {
		const pubKeyField: TransactionAuthField = {
			type: "publicKey",
			pubKeyEncoding: PubKeyEncoding.Compressed,
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			data: publicKeys[i]!,
		};
		fields.push(pubKeyField);
		const preSign = sigHashPreSign(
			sigHash,
			AuthType.Standard,
			condition.fee,
			condition.nonce,
		);
		sigHash = sigHashPostSign(
			preSign,
			pubKeyField.pubKeyEncoding,
			pubKeyField.data,
		);
	}

	return { ...condition, fields };
}

/** Combine independently-signed non-sequential multi-sig transactions */
export function combineMultiSigSignatures(
	baseTx: StacksTransaction,
	signedTxs: StacksTransaction[],
): StacksTransaction {
	const condition = baseTx.auth.spendingCondition as MultiSigSpendingCondition;

	if (!isNonSequential(condition.hashMode)) {
		throw new Error(
			"combineMultiSigSignatures only works with non-sequential hash modes (SIP-027)",
		);
	}

	const seenSigs = new Set<string>();
	const signatures: TransactionAuthField[] = [];

	for (const stx of signedTxs) {
		const stxCondition = stx.auth
			.spendingCondition as MultiSigSpendingCondition;
		for (const field of stxCondition.fields) {
			if (field.type === "signature" && !seenSigs.has(field.data)) {
				seenSigs.add(field.data);
				signatures.push(field);
			}
		}
	}

	if (signatures.length === 0) {
		throw new Error("No signatures found in the provided transactions");
	}

	const newCondition: MultiSigSpendingCondition = {
		...condition,
		fields: signatures,
	};

	return {
		...baseTx,
		auth: { ...baseTx.auth, spendingCondition: newCondition },
	};
}
