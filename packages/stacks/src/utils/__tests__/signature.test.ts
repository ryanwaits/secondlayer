import { describe, expect, test, beforeAll } from "bun:test";
import {
  parseSignature,
  serializeSignature,
  signatureVrsToRsv,
  signatureRsvToVrs,
  recoverPublicKey,
  recoverAddress,
  verifySignature,
  verifyMessageSignature,
} from "../signature.ts";
import { signAsync, getPublicKey, etc } from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "../encoding.ts";

// Set up hmacSha256Sync for noble/secp256k1 sign operations
beforeAll(() => {
  etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
    const h = hmac.create(sha256, key);
    for (const msg of msgs) h.update(msg);
    return h.digest();
  };
});

// Test vectors from old stacks.js
const PRIVATE_KEY = "bcf62fdd286f9b30b2c289cce3189dbf3b502dcd955b2dc4f67d18d77f3e73c7";
const PUBLIC_KEY = "0290255f88fa311f5dee9425ce33d7d516c24157e2aae8e25a6c631dd6f7322aef";
const MESSAGE_HASH = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e";
const SIGNATURE_VRS =
  "00f540e429fc6e8a4c27f2782479e739cae99aa21e8cb25d4436f333577bc791cd1d9672055dd1604dd5194b88076e4f859dd93c834785ed589ec38291698d4142";
const SIGNATURE_RSV =
  "f540e429fc6e8a4c27f2782479e739cae99aa21e8cb25d4436f333577bc791cd1d9672055dd1604dd5194b88076e4f859dd93c834785ed589ec38291698d414200";

describe("parseSignature", () => {
  test("parses VRS hex into components", () => {
    const parsed = parseSignature(SIGNATURE_VRS);
    expect(parsed.recovery).toBe(0);
    expect(parsed.r).toBe(
      "f540e429fc6e8a4c27f2782479e739cae99aa21e8cb25d4436f333577bc791cd"
    );
    expect(parsed.s).toBe(
      "1d9672055dd1604dd5194b88076e4f859dd93c834785ed589ec38291698d4142"
    );
  });

  test("throws on invalid length", () => {
    expect(() => parseSignature("deadbeef")).toThrow("Invalid signature length");
  });
});

describe("serializeSignature", () => {
  test("roundtrip with parse", () => {
    const parsed = parseSignature(SIGNATURE_VRS);
    expect(serializeSignature(parsed)).toBe(SIGNATURE_VRS);
  });
});

describe("VRS / RSV conversion", () => {
  test("vrs to rsv", () => {
    expect(signatureVrsToRsv(SIGNATURE_VRS)).toBe(SIGNATURE_RSV);
  });

  test("rsv to vrs", () => {
    expect(signatureRsvToVrs(SIGNATURE_RSV)).toBe(SIGNATURE_VRS);
  });

  test("roundtrip", () => {
    expect(signatureRsvToVrs(signatureVrsToRsv(SIGNATURE_VRS))).toBe(SIGNATURE_VRS);
    expect(signatureVrsToRsv(signatureRsvToVrs(SIGNATURE_RSV))).toBe(SIGNATURE_RSV);
  });
});

describe("recoverPublicKey", () => {
  test("recovers compressed public key from VRS sig", () => {
    const recovered = recoverPublicKey(MESSAGE_HASH, SIGNATURE_VRS, true);
    expect(recovered).toBe(PUBLIC_KEY);
  });

  test("recovers from Uint8Array hash", () => {
    const hashBytes = hexToBytes(MESSAGE_HASH);
    const recovered = recoverPublicKey(hashBytes, SIGNATURE_VRS, true);
    expect(recovered).toBe(PUBLIC_KEY);
  });

  test("fresh sign → recover roundtrip", async () => {
    const privKey = "edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc";
    const expectedPubKey = bytesToHex(getPublicKey(privKey, true));
    const msgHash = sha256(utf8ToBytes("hello world"));
    const sig = await signAsync(msgHash, privKey);

    const v = sig.recovery!.toString(16).padStart(2, "0");
    const vrs = v + sig.toCompactHex();

    const recovered = recoverPublicKey(msgHash, vrs, true);
    expect(recovered).toBe(expectedPubKey);
  });
});

describe("recoverAddress", () => {
  test("recovers mainnet address by default", () => {
    const address = recoverAddress(MESSAGE_HASH, SIGNATURE_VRS);
    expect(address).toMatch(/^SP/);
  });

  test("recovers testnet address", () => {
    const address = recoverAddress(MESSAGE_HASH, SIGNATURE_VRS, 26);
    expect(address).toMatch(/^ST/);
  });
});

describe("verifySignature", () => {
  test("verifies a valid compact signature", () => {
    const parsed = parseSignature(SIGNATURE_VRS);
    const compactHex = parsed.r + parsed.s;
    expect(verifySignature(MESSAGE_HASH, compactHex, PUBLIC_KEY)).toBe(true);
  });

  test("rejects wrong public key", () => {
    const parsed = parseSignature(SIGNATURE_VRS);
    const compactHex = parsed.r + parsed.s;
    const wrongKey = bytesToHex(
      getPublicKey("edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc", true)
    );
    expect(verifySignature(MESSAGE_HASH, compactHex, wrongKey)).toBe(false);
  });

  test("fresh sign + verify roundtrip", async () => {
    const privKey = "edf9aee84d9b7abc145504dde6726c64f369d37ee34ded868fabd876c26570bc";
    const pubKey = bytesToHex(getPublicKey(privKey, true));
    const msgHash = sha256(utf8ToBytes("test message"));

    const sig = await signAsync(msgHash, privKey);
    const compact = sig.toCompactHex();

    expect(verifySignature(msgHash, compact, pubKey)).toBe(true);
  });
});

describe("verifyMessageSignature", () => {
  test("sign and verify message roundtrip", async () => {
    const privKey = "bcf62fdd286f9b30b2c289cce3189dbf3b502dcd955b2dc4f67d18d77f3e73c7";
    const pubKey = bytesToHex(getPublicKey(privKey, true));
    const message = "Hello World";

    // Hash with Stacks prefix manually
    const prefix = "\x17Stacks Signed Message:\n";
    const msgBytes = utf8ToBytes(message);
    const prefixBytes = utf8ToBytes(prefix);
    const lenByte = new Uint8Array([msgBytes.length]);
    const encoded = new Uint8Array([...prefixBytes, ...lenByte, ...msgBytes]);
    const msgHash = sha256(encoded);

    const sig = await signAsync(msgHash, privKey);
    const v = sig.recovery!.toString(16).padStart(2, "0");
    const vrs = v + sig.toCompactHex();

    expect(verifyMessageSignature(message, vrs, pubKey)).toBe(true);
  });

  test("rejects invalid message", async () => {
    const privKey = "bcf62fdd286f9b30b2c289cce3189dbf3b502dcd955b2dc4f67d18d77f3e73c7";
    const pubKey = bytesToHex(getPublicKey(privKey, true));

    // Sign "Hello World"
    const prefix = "\x17Stacks Signed Message:\n";
    const msgBytes = utf8ToBytes("Hello World");
    const prefixBytes = utf8ToBytes(prefix);
    const lenByte = new Uint8Array([msgBytes.length]);
    const encoded = new Uint8Array([...prefixBytes, ...lenByte, ...msgBytes]);
    const msgHash = sha256(encoded);

    const sig = await signAsync(msgHash, privKey);
    const v = sig.recovery!.toString(16).padStart(2, "0");
    const vrs = v + sig.toCompactHex();

    expect(verifyMessageSignature("Wrong Message", vrs, pubKey)).toBe(false);
  });
});
