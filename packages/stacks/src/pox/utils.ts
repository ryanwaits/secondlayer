import { bech32, bech32m } from "@scure/base";
import { hash160 } from "../utils/hash.ts";
import { hexToBytes } from "../utils/encoding.ts";
import type { PoxAddress } from "./types.ts";
import { MIN_LOCK_PERIOD, MAX_LOCK_PERIOD, POX_ADDRESS_VERSION } from "./constants.ts";

/**
 * Base58 alphabet (Bitcoin standard).
 * Used for decoding legacy P2PKH and P2SH addresses.
 */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array {
  let num = 0n;
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }

  // Convert bigint to bytes
  const hex = num.toString(16).padStart(2, "0");
  const padded = hex.length % 2 ? "0" + hex : hex;
  const rawBytes = hexToBytes(padded);

  // Count leading zeros
  let leadingZeros = 0;
  for (const char of str) {
    if (char === "1") leadingZeros++;
    else break;
  }

  const result = new Uint8Array(leadingZeros + rawBytes.length);
  result.set(rawBytes, leadingZeros);
  return result;
}

/**
 * Parse a Bitcoin address string into a PoX address tuple.
 * Supports P2PKH, P2SH, P2WPKH, P2WSH, P2TR (mainnet and testnet).
 */
export function parseBtcAddress(address: string): PoxAddress {
  // Bech32/Bech32m (segwit / taproot)
  if (
    address.startsWith("bc1") ||
    address.startsWith("tb1") ||
    address.startsWith("bcrt1")
  ) {
    return parseSegwitAddress(address);
  }

  // Legacy base58check (P2PKH / P2SH)
  return parseLegacyAddress(address);
}

function parseSegwitAddress(address: string): PoxAddress {
  // Try bech32 first (v0), then bech32m (v1+)
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(address as `${string}1${string}`);
  } catch {
    decoded = bech32m.decode(address as `${string}1${string}`);
  }

  const witnessVersion = decoded.words[0]!;
  const data = bech32.fromWords(decoded.words.slice(1));
  const hashbytes = new Uint8Array(data);

  let version: number;
  if (witnessVersion === 0) {
    if (hashbytes.length === 20) {
      version = POX_ADDRESS_VERSION.p2wpkh;
    } else if (hashbytes.length === 32) {
      version = POX_ADDRESS_VERSION.p2wsh;
    } else {
      throw new Error(`Invalid witness v0 program length: ${hashbytes.length}`);
    }
  } else if (witnessVersion === 1) {
    if (hashbytes.length !== 32) {
      throw new Error(`Invalid witness v1 program length: ${hashbytes.length}`);
    }
    version = POX_ADDRESS_VERSION.p2tr;
  } else {
    throw new Error(`Unsupported witness version: ${witnessVersion}`);
  }

  // Pad to 32 bytes (PoX requires buff 32 for hashbytes)
  const padded = new Uint8Array(32);
  padded.set(hashbytes);

  return {
    version: new Uint8Array([version]),
    hashbytes: padded,
  };
}

function parseLegacyAddress(address: string): PoxAddress {
  const decoded = base58Decode(address);

  // base58check: 1 byte version + 20 byte hash + 4 byte checksum = 25 bytes
  if (decoded.length !== 25) {
    throw new Error(`Invalid legacy address length: ${decoded.length}`);
  }

  const versionByte = decoded[0]!;
  const hashbytes = decoded.slice(1, 21);

  let version: number;
  // Mainnet P2PKH: 0x00, Testnet P2PKH: 0x6f
  if (versionByte === 0x00 || versionByte === 0x6f) {
    version = POX_ADDRESS_VERSION.p2pkh;
  }
  // Mainnet P2SH: 0x05, Testnet P2SH: 0xc4
  else if (versionByte === 0x05 || versionByte === 0xc4) {
    version = POX_ADDRESS_VERSION.p2sh;
  } else {
    throw new Error(`Unknown legacy address version byte: 0x${versionByte.toString(16)}`);
  }

  // Pad to 32 bytes
  const padded = new Uint8Array(32);
  padded.set(hashbytes);

  return {
    version: new Uint8Array([version]),
    hashbytes: padded,
  };
}

/** Validate lock period is within allowed range (1-12). */
export function validateLockPeriod(periods: number): boolean {
  return (
    Number.isInteger(periods) &&
    periods >= MIN_LOCK_PERIOD &&
    periods <= MAX_LOCK_PERIOD
  );
}

/** Calculate the reward cycle for a given burn height. */
export function burnHeightToRewardCycle(
  burnHeight: bigint,
  firstBurnchainBlockHeight: bigint,
  rewardCycleLength: bigint
): bigint {
  return (burnHeight - firstBurnchainBlockHeight) / rewardCycleLength;
}

/** Calculate the burn height at which a reward cycle starts. */
export function rewardCycleToBurnHeight(
  cycle: bigint,
  firstBurnchainBlockHeight: bigint,
  rewardCycleLength: bigint
): bigint {
  return firstBurnchainBlockHeight + cycle * rewardCycleLength;
}
