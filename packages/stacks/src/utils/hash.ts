import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "./encoding.ts";

export { sha256, sha512_256, ripemd160 };

/** RIPEMD160(SHA256(input)) — standard Bitcoin/Stacks address hash */
export function hash160(input: Uint8Array): Uint8Array {
  return ripemd160(sha256(input));
}

/** Hash used for transaction IDs */
export function txidFromBytes(data: Uint8Array): string {
  return bytesToHex(sha512_256(data));
}

/** hash160 as hex — used for P2PKH address derivation */
export function hashP2PKH(input: Uint8Array): string {
  return bytesToHex(hash160(input));
}
