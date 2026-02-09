import {
  getPublicKey as nobleGetPublicKey,
  sign,
  etc,
} from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { c32address } from "../utils/c32.ts";
import { bytesToHex, hexToBytes, without0x } from "../utils/encoding.ts";
import { hash160 } from "../utils/hash.ts";
import type { LocalAccount } from "./types.ts";

function ensureSyncSigning() {
  if (!etc.hmacSha256Sync) {
    etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
      const h = hmac.create(sha256, key);
      msgs.forEach((msg) => h.update(msg));
      return h.digest();
    };
  }
}

const PRIVATE_KEY_COMPRESSED_LENGTH = 33;

export function privateKeyToAccount(
  privateKey: string | Uint8Array,
  options?: { addressVersion?: number }
): LocalAccount {
  ensureSyncSigning();
  const keyBytes = normalizePrivateKey(privateKey);
  const rawKey = keyBytes.slice(0, 32);

  // Always derive compressed public key
  const publicKeyBytes = nobleGetPublicKey(rawKey, true);
  const publicKeyHex = bytesToHex(publicKeyBytes);

  // Default to mainnet single-sig (22)
  const addressVersion = options?.addressVersion ?? 22;
  const address = c32address(addressVersion, bytesToHex(hash160(publicKeyBytes)));

  return {
    type: "local",
    address,
    publicKey: publicKeyHex,

    sign(hash: Uint8Array): Uint8Array {
      const sig = sign(hash, rawKey, { lowS: true });
      const result = new Uint8Array(65);
      result[0] = sig.recovery;
      result.set(sig.toCompactRawBytes(), 1);
      return result;
    },

    signMessage(message: string | Uint8Array): string {
      const msgBytes =
        typeof message === "string"
          ? new TextEncoder().encode(message)
          : message;
      const msgHash = sha256(msgBytes);
      const sigBytes = this.sign(msgHash);
      return bytesToHex(sigBytes);
    },
  };
}

function normalizePrivateKey(key: string | Uint8Array): Uint8Array {
  if (typeof key === "string") {
    return hexToBytes(without0x(key));
  }
  return key;
}

/** Append 0x01 suffix if not already compressed */
export function compressPrivateKey(key: string | Uint8Array): string {
  const hex = typeof key === "string" ? without0x(key) : bytesToHex(key);
  if (hex.length === PRIVATE_KEY_COMPRESSED_LENGTH * 2) return hex;
  return `${hex}01`;
}
