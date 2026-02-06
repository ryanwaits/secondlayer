import { describe, expect, test } from "bun:test";
import {
  compressPublicKey,
  uncompressPublicKey,
  isCompressedPublicKey,
  randomBytes,
} from "../keys.ts";
import { hexToBytes } from "../encoding.ts";

// Known test vector from old stacks.js (derived from privkey edf9aee8...)
const COMPRESSED =
  "03ef788b3830c00abe8f64f62dc32fc863bc0b2cafeb073b6c8e1c7657d9c2c3ab";
const UNCOMPRESSED =
  "04ef788b3830c00abe8f64f62dc32fc863bc0b2cafeb073b6c8e1c7657d9c2c3ab5b435d20ea91337cdd8c30dd7427bb098a5355e9c9bfad43797899b8137237cf";

describe("compressPublicKey", () => {
  test("compresses an uncompressed key", () => {
    expect(compressPublicKey(UNCOMPRESSED)).toBe(COMPRESSED);
  });

  test("already compressed key stays the same", () => {
    expect(compressPublicKey(COMPRESSED)).toBe(COMPRESSED);
  });

  test("accepts Uint8Array", () => {
    expect(compressPublicKey(hexToBytes(UNCOMPRESSED))).toBe(COMPRESSED);
  });
});

describe("uncompressPublicKey", () => {
  test("uncompresses a compressed key", () => {
    expect(uncompressPublicKey(COMPRESSED)).toBe(UNCOMPRESSED);
  });

  test("already uncompressed key stays the same", () => {
    expect(uncompressPublicKey(UNCOMPRESSED)).toBe(UNCOMPRESSED);
  });

  test("accepts Uint8Array", () => {
    expect(uncompressPublicKey(hexToBytes(COMPRESSED))).toBe(UNCOMPRESSED);
  });
});

describe("compress/uncompress roundtrip", () => {
  test("compress → uncompress → compress", () => {
    const result = compressPublicKey(uncompressPublicKey(COMPRESSED));
    expect(result).toBe(COMPRESSED);
  });
});

describe("isCompressedPublicKey", () => {
  test("compressed key returns true", () => {
    expect(isCompressedPublicKey(COMPRESSED)).toBe(true);
  });

  test("uncompressed key returns false", () => {
    expect(isCompressedPublicKey(UNCOMPRESSED)).toBe(false);
  });

  test("Uint8Array works", () => {
    expect(isCompressedPublicKey(hexToBytes(COMPRESSED))).toBe(true);
    expect(isCompressedPublicKey(hexToBytes(UNCOMPRESSED))).toBe(false);
  });
});

describe("randomBytes", () => {
  test("default length is 32", () => {
    expect(randomBytes().length).toBe(32);
  });

  test("custom length", () => {
    expect(randomBytes(16).length).toBe(16);
    expect(randomBytes(64).length).toBe(64);
  });

  test("returns different values", () => {
    const a = randomBytes();
    const b = randomBytes();
    expect(a).not.toEqual(b);
  });
});
