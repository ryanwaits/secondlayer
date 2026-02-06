import {
  getPublicKey as nobleGetPublicKey,
  sign,
  etc,
} from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  hexToBytes,
  intToBytes,
  intToHex,
  concatBytes,
} from "../utils/encoding.ts";
import { hashP2PKH, txidFromBytes } from "../utils/hash.ts";
import {
  AuthType,
  AddressHashMode,
  PubKeyEncoding,
  RECOVERABLE_ECDSA_SIG_LENGTH_BYTES,
  type SingleSigSpendingCondition,
  type SpendingCondition,
  type Authorization,
  type StandardAuthorization,
  type SponsoredAuthorization,
} from "./types.ts";

// Ensure sync signing is available
etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const h = hmac.create(sha256, key);
  msgs.forEach((msg) => h.update(msg));
  return h.digest();
};

const EMPTY_SIG = bytesToHex(new Uint8Array(RECOVERABLE_ECDSA_SIG_LENGTH_BYTES));

export function createSingleSigSpendingCondition(
  publicKey: string,
  nonce: bigint,
  fee: bigint
): SingleSigSpendingCondition {
  const pubKeyBytes = hexToBytes(publicKey);
  const signer = hashP2PKH(pubKeyBytes);
  const isCompressed = pubKeyBytes.length === 33;

  return {
    hashMode: AddressHashMode.P2PKH,
    signer,
    nonce,
    fee,
    keyEncoding: isCompressed ? PubKeyEncoding.Compressed : PubKeyEncoding.Uncompressed,
    signature: EMPTY_SIG,
  };
}

export function createStandardAuth(
  spendingCondition: SpendingCondition
): StandardAuthorization {
  return { authType: AuthType.Standard, spendingCondition };
}

export function createSponsoredAuth(
  spendingCondition: SpendingCondition,
  sponsorSpendingCondition?: SpendingCondition
): SponsoredAuthorization {
  return {
    authType: AuthType.Sponsored,
    spendingCondition,
    sponsorSpendingCondition: sponsorSpendingCondition ?? createSingleSigSpendingCondition(
      "0".repeat(66),
      0n,
      0n
    ),
  };
}

function clearCondition(condition: SpendingCondition): SpendingCondition {
  if ("signature" in condition) {
    return {
      ...condition,
      nonce: 0n,
      fee: 0n,
      signature: EMPTY_SIG,
    };
  }
  return {
    ...condition,
    nonce: 0n,
    fee: 0n,
    fields: [],
  };
}

export function intoInitialSighashAuth(auth: Authorization): Authorization {
  if (auth.authType === AuthType.Standard) {
    return createStandardAuth(clearCondition(auth.spendingCondition));
  }
  return createSponsoredAuth(
    clearCondition(auth.spendingCondition),
    clearCondition(createSingleSigSpendingCondition("0".repeat(66), 0n, 0n))
  );
}

/** Compute pre-sign sighash = sha512/256(prevSigHash + authType + fee + nonce) */
export function sigHashPreSign(
  curSigHash: string,
  authType: number,
  fee: bigint,
  nonce: bigint
): string {
  const data = concatBytes(
    hexToBytes(curSigHash),
    new Uint8Array([authType]),
    intToBytes(fee, 8),
    intToBytes(nonce, 8)
  );
  return txidFromBytes(data);
}

/** Compute post-sign sighash = sha512/256(preSigHash + pubKeyEncoding + signature) */
export function sigHashPostSign(
  curSigHash: string,
  pubKeyEncoding: number,
  signature: string
): string {
  const data = concatBytes(
    hexToBytes(curSigHash),
    new Uint8Array([pubKeyEncoding]),
    hexToBytes(signature)
  );
  return txidFromBytes(data);
}

/** Sign with private key and return VRS signature (recoveryId + r + s) */
function signWithKey(privateKey: string, messageHash: string): string {
  const keyBytes = hexToBytes(privateKey).slice(0, 32);
  const sig = sign(messageHash, keyBytes, { lowS: true });
  const recoveryIdHex = intToHex(sig.recovery, 1);
  return recoveryIdHex + sig.toCompactHex();
}

export function nextSignature(
  curSigHash: string,
  authType: number,
  fee: bigint,
  nonce: bigint,
  privateKey: string
): { nextSig: string; nextSigHash: string } {
  const sigHashPre = sigHashPreSign(curSigHash, authType, fee, nonce);

  const keyBytes = hexToBytes(privateKey).slice(0, 32);
  const pubKey = nobleGetPublicKey(keyBytes, true);
  const isCompressed = pubKey.length === 33;
  const pubKeyEncoding = isCompressed
    ? PubKeyEncoding.Compressed
    : PubKeyEncoding.Uncompressed;

  const nextSig = signWithKey(privateKey, sigHashPre);
  const nextSigHash = sigHashPostSign(sigHashPre, pubKeyEncoding, nextSig);

  return { nextSig, nextSigHash };
}
