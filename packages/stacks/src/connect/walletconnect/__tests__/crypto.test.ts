import { test, expect, describe } from "bun:test";
import {
  generateKeyPair,
  generateSymKey,
  deriveSymKey,
  symKeyToTopic,
  encryptType0,
  decryptType0,
  encryptType1,
  decryptType1,
  decrypt,
  encodeBase64,
  decodeBase64,
} from "../crypto.ts";

describe("crypto", () => {
  test("generateKeyPair returns 32-byte keys", () => {
    const kp = generateKeyPair();
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicKey.length).toBe(32);
  });

  test("generateSymKey returns 32 bytes", () => {
    const key = generateSymKey();
    expect(key.length).toBe(32);
  });

  test("deriveSymKey is deterministic", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const s1 = deriveSymKey(a.privateKey, b.publicKey);
    const s2 = deriveSymKey(a.privateKey, b.publicKey);
    expect(s1).toEqual(s2);
  });

  test("symKeyToTopic returns 64-char hex", () => {
    const key = generateSymKey();
    const topic = symKeyToTopic(key);
    expect(topic.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(topic)).toBe(true);
  });

  test("symKeyToTopic is deterministic", () => {
    const key = generateSymKey();
    expect(symKeyToTopic(key)).toBe(symKeyToTopic(key));
  });

  describe("base64", () => {
    test("roundtrip", () => {
      const data = new Uint8Array([0, 1, 2, 255, 128, 64]);
      const encoded = encodeBase64(data);
      expect(typeof encoded).toBe("string");
      expect(decodeBase64(encoded)).toEqual(data);
    });

    test("empty data", () => {
      const data = new Uint8Array(0);
      expect(decodeBase64(encodeBase64(data))).toEqual(data);
    });
  });

  describe("type 0 envelope", () => {
    test("encrypt/decrypt roundtrip", () => {
      const key = generateSymKey();
      const msg = '{"jsonrpc":"2.0","method":"test","params":{}}';
      const envelope = encryptType0(key, msg);
      expect(envelope[0]).toBe(0x00);
      expect(envelope.length).toBeGreaterThan(1 + 12 + 16); // type + iv + tag at minimum
      expect(decryptType0(key, envelope)).toBe(msg);
    });

    test("different IVs produce different ciphertexts", () => {
      const key = generateSymKey();
      const msg = "hello";
      const e1 = encryptType0(key, msg);
      const e2 = encryptType0(key, msg);
      // IVs are random, so envelopes differ
      expect(e1).not.toEqual(e2);
      // But both decrypt to same message
      expect(decryptType0(key, e1)).toBe(msg);
      expect(decryptType0(key, e2)).toBe(msg);
    });

    test("wrong key fails", () => {
      const key1 = generateSymKey();
      const key2 = generateSymKey();
      const envelope = encryptType0(key1, "secret");
      expect(() => decryptType0(key2, envelope)).toThrow();
    });

    test("rejects type-1 envelope", () => {
      const envelope = new Uint8Array([0x01, 0, 0, 0]);
      expect(() => decryptType0(generateSymKey(), envelope)).toThrow("Not a type-0 envelope");
    });
  });

  describe("type 1 envelope", () => {
    test("encrypt/decrypt roundtrip", () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();
      const msg = '{"method":"wc_sessionPropose"}';
      const envelope = encryptType1(sender.privateKey, receiver.publicKey, msg);
      expect(envelope[0]).toBe(0x01);
      expect(decryptType1(receiver.privateKey, envelope)).toBe(msg);
    });

    test("sender pubkey embedded in envelope", () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();
      const envelope = encryptType1(sender.privateKey, receiver.publicKey, "test");
      const embeddedPubkey = envelope.subarray(1, 33);
      expect(embeddedPubkey).toEqual(sender.publicKey);
    });

    test("wrong receiver key fails", () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();
      const wrong = generateKeyPair();
      const envelope = encryptType1(sender.privateKey, receiver.publicKey, "test");
      expect(() => decryptType1(wrong.privateKey, envelope)).toThrow();
    });
  });

  describe("unified decrypt", () => {
    test("dispatches to type 0", () => {
      const key = generateSymKey();
      const envelope = encryptType0(key, "type0");
      expect(decrypt(key, envelope)).toBe("type0");
    });

    test("dispatches to type 1", () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();
      const envelope = encryptType1(sender.privateKey, receiver.publicKey, "type1");
      expect(decrypt(receiver.privateKey, envelope)).toBe("type1");
    });
  });

  test("unicode content roundtrip", () => {
    const key = generateSymKey();
    const msg = "Hello \u{1f310} unicode \u00e9\u00e8\u00ea";
    expect(decryptType0(key, encryptType0(key, msg))).toBe(msg);
  });

  test("large payload roundtrip", () => {
    const key = generateSymKey();
    const msg = JSON.stringify({ data: "x".repeat(10000) });
    expect(decryptType0(key, encryptType0(key, msg))).toBe(msg);
  });
});
