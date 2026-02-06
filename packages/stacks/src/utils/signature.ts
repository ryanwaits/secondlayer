import { Signature as NobleSignature, verify, Point } from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes } from "./encoding.ts";
import { hash160, hashP2PKH } from "./hash.ts";
import { c32address } from "./address.ts";
import { AddressVersion } from "./constants.ts";

export interface RecoverableSignature {
  /** Recovery id (0–3) */
  recovery: number;
  /** 32-byte r value as hex */
  r: string;
  /** 32-byte s value as hex */
  s: string;
}

// --- Format conversion ---

/**
 * Parse a 65-byte VRS hex signature into components.
 * VRS format: recovery (1 byte) + r (32 bytes) + s (32 bytes)
 */
export function parseSignature(hex: string): RecoverableSignature {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length !== 130) {
    throw new Error(`Invalid signature length: expected 130 hex chars, got ${clean.length}`);
  }
  return {
    recovery: parseInt(clean.slice(0, 2), 16),
    r: clean.slice(2, 66),
    s: clean.slice(66, 130),
  };
}

/**
 * Serialize a recoverable signature to 65-byte VRS hex (130 chars).
 */
export function serializeSignature(sig: RecoverableSignature): string {
  const v = sig.recovery.toString(16).padStart(2, "0");
  return v + sig.r + sig.s;
}

/** Convert VRS hex to RSV hex: r+s (128 chars) + recovery (2 chars). */
export function signatureVrsToRsv(vrs: string): string {
  const clean = vrs.startsWith("0x") ? vrs.slice(2) : vrs;
  return clean.slice(2) + clean.slice(0, 2);
}

/** Convert RSV hex to VRS hex: recovery (2 chars) + r+s (128 chars). */
export function signatureRsvToVrs(rsv: string): string {
  const clean = rsv.startsWith("0x") ? rsv.slice(2) : rsv;
  return clean.slice(-2) + clean.slice(0, -2);
}

// --- Recovery ---

/**
 * Recover a public key from a message hash and VRS signature.
 * @returns hex-encoded public key (33 bytes compressed, or 65 bytes uncompressed)
 */
export function recoverPublicKey(
  hash: Uint8Array | string,
  signature: string,
  compressed = true
): string {
  const parsed = parseSignature(signature);
  const rs = parsed.r + parsed.s;
  const sig = NobleSignature.fromCompact(rs).addRecoveryBit(parsed.recovery);
  const msgHash = typeof hash === "string" ? hexToBytes(hash) : hash;
  const point = sig.recoverPublicKey(msgHash);
  return point.toHex(compressed);
}

/**
 * Recover a Stacks address from a message hash and VRS signature.
 * @param addressVersion defaults to MainnetSingleSig (22)
 */
export function recoverAddress(
  hash: Uint8Array | string,
  signature: string,
  addressVersion: number = AddressVersion.MainnetSingleSig
): string {
  const pubkey = recoverPublicKey(hash, signature, true);
  const pubkeyHash = hashP2PKH(hexToBytes(pubkey));
  return c32address(addressVersion, pubkeyHash);
}

// --- Verification ---

/**
 * Verify an ECDSA signature against a message hash and public key.
 * Accepts compact (64-byte) signature as hex or Uint8Array.
 */
export function verifySignature(
  hash: Uint8Array | string,
  signature: string | Uint8Array,
  publicKey: string | Uint8Array
): boolean {
  return verify(signature, hash, publicKey, { lowS: false });
}

/** Bitcoin-style varint encoding for message length prefix. */
function encodeVarint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  const buf = new Uint8Array(5);
  buf[0] = 0xfe;
  buf[1] = n & 0xff;
  buf[2] = (n >> 8) & 0xff;
  buf[3] = (n >> 16) & 0xff;
  buf[4] = (n >> 24) & 0xff;
  return buf;
}

const STACKS_MESSAGE_PREFIX = "\x17Stacks Signed Message:\n";
const LEGACY_MESSAGE_PREFIX = "\x18Stacks Message Signing:\n";

/** Hash a message with the Stacks structured message prefix. */
function hashMessage(message: string | Uint8Array, prefix: string): Uint8Array {
  const messageBytes = typeof message === "string" ? utf8ToBytes(message) : message;
  const prefixBytes = utf8ToBytes(prefix);
  const lengthBytes = encodeVarint(messageBytes.length);
  return sha256(concatBytes(prefixBytes, lengthBytes, messageBytes));
}

/**
 * Verify a signed Stacks message.
 * Parses a VRS signature, extracts r+s for verification.
 * Falls back to legacy prefix if standard prefix fails.
 */
export function verifyMessageSignature(
  message: string | Uint8Array,
  signature: string,
  publicKey: string
): boolean {
  const parsed = parseSignature(signature);
  const compactSig = parsed.r + parsed.s;

  const msgHash = hashMessage(message, STACKS_MESSAGE_PREFIX);
  if (verify(compactSig, msgHash, publicKey, { lowS: false })) return true;

  // Fallback to legacy prefix
  if (typeof message === "string") {
    const legacyHash = hashMessage(message, LEGACY_MESSAGE_PREFIX);
    if (verify(compactSig, legacyHash, publicKey, { lowS: false })) return true;
  }

  return false;
}
