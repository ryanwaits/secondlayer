import { Point, etc } from "@noble/secp256k1";
import { bytesToHex, hexToBytes } from "./encoding.ts";

/** Compress a public key to 33 bytes (hex). */
export function compressPublicKey(publicKey: string | Uint8Array): string {
  const hex = typeof publicKey === "string" ? publicKey : bytesToHex(publicKey);
  return Point.fromHex(hex).toHex(true);
}

/** Uncompress a public key to 65 bytes (hex). */
export function uncompressPublicKey(publicKey: string | Uint8Array): string {
  const hex = typeof publicKey === "string" ? publicKey : bytesToHex(publicKey);
  return Point.fromHex(hex).toHex(false);
}

/** Check if a public key is in compressed format (starts with 0x02 or 0x03). */
export function isCompressedPublicKey(publicKey: string | Uint8Array): boolean {
  const bytes = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  return bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03);
}

/** Generate cryptographically secure random bytes. Defaults to 32 bytes. */
export function randomBytes(length?: number): Uint8Array {
  return etc.randomBytes(length ?? 32);
}
