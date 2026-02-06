import { describe, it, expect } from "bun:test";
import {
  isUint128,
  isInt128,
  isBool,
  isPrincipal,
  isStandardPrincipal,
  isContractPrincipal,
  isTraitReference,
  isOkResponse,
  isErrResponse,
  isResponse,
  isArray,
  isOptional,
  isAbiList,
  isAbiTuple,
  isAbiOptional,
  isAbiResponse,
  isAbiBuffer,
  isAbiStringAscii,
  isAbiStringUtf8,
  isAbiTraitReference,
} from "../guards.ts";
import { MAX_U128, MIN_I128, MAX_I128 } from "../types.ts";

describe("Value Guards", () => {
  describe("isUint128", () => {
    it("should validate valid uint128 values", () => {
      expect(isUint128(0n)).toBe(true);
      expect(isUint128(123n)).toBe(true);
      expect(isUint128(MAX_U128)).toBe(true);
    });

    it("should reject invalid uint128 values", () => {
      expect(isUint128(-1n)).toBe(false);
      expect(isUint128(MAX_U128 + 1n)).toBe(false);
      expect(isUint128(123)).toBe(false);
      expect(isUint128("123")).toBe(false);
      expect(isUint128(null)).toBe(false);
    });
  });

  describe("isInt128", () => {
    it("should validate valid int128 values", () => {
      expect(isInt128(0n)).toBe(true);
      expect(isInt128(123n)).toBe(true);
      expect(isInt128(-123n)).toBe(true);
      expect(isInt128(MIN_I128)).toBe(true);
      expect(isInt128(MAX_I128)).toBe(true);
    });

    it("should reject invalid int128 values", () => {
      expect(isInt128(MIN_I128 - 1n)).toBe(false);
      expect(isInt128(MAX_I128 + 1n)).toBe(false);
      expect(isInt128(123)).toBe(false);
      expect(isInt128("123")).toBe(false);
    });
  });

  describe("Principal validation", () => {
    it("should validate mainnet standard principals", () => {
      expect(isPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(true);
      expect(isStandardPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(true);
      expect(isContractPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(false);
    });

    it("should validate testnet principals", () => {
      expect(isPrincipal("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")).toBe(true);
      expect(isStandardPrincipal("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")).toBe(true);
    });

    it("should validate contract principals", () => {
      const cp = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract";
      expect(isPrincipal(cp)).toBe(true);
      expect(isStandardPrincipal(cp)).toBe(false);
      expect(isContractPrincipal(cp)).toBe(true);
    });

    it("should validate testnet contract principals", () => {
      const cp = "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG.test-contract";
      expect(isPrincipal(cp)).toBe(true);
      expect(isContractPrincipal(cp)).toBe(true);
    });

    it("should reject invalid principals", () => {
      expect(isPrincipal("invalid")).toBe(false);
      expect(isPrincipal("SP123")).toBe(false);
      expect(isPrincipal("")).toBe(false);
      expect(isPrincipal(null)).toBe(false);
    });

    it("should reject principals with invalid checksums", () => {
      expect(isPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ8")).toBe(false);
    });

    it("should reject contract principals with invalid contract names", () => {
      expect(isContractPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.123invalid")).toBe(false);
      expect(isContractPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.")).toBe(false);
    });
  });

  describe("Response type guards", () => {
    it("should identify ok responses", () => {
      expect(isOkResponse({ ok: true })).toBe(true);
      expect(isOkResponse({ err: "error" })).toBe(false);
      expect(isErrResponse({ ok: true })).toBe(false);
      expect(isErrResponse({ err: "error" })).toBe(true);
    });

    it("should validate response with guards", () => {
      expect(isResponse({ ok: 123n }, isUint128, (v): v is string => typeof v === "string")).toBe(true);
      expect(isResponse({ err: "error" }, isUint128, (v): v is string => typeof v === "string")).toBe(true);
      expect(isResponse({ ok: "invalid" }, isUint128, (v): v is string => typeof v === "string")).toBe(false);
    });
  });

  describe("Array and Optional guards", () => {
    it("should validate arrays", () => {
      expect(isArray([1n, 2n, 3n], isUint128)).toBe(true);
      expect(isArray([1n, -2n, 3n], isUint128)).toBe(false);
      expect(isArray([], isUint128)).toBe(true);
    });

    it("should validate optionals", () => {
      expect(isOptional(null, isUint128)).toBe(true);
      expect(isOptional(123n, isUint128)).toBe(true);
      expect(isOptional(-1n, isUint128)).toBe(false);
    });
  });
});

describe("ABI Type Definition Guards", () => {
  it("should identify list types", () => {
    expect(isAbiList({ list: { type: "uint128", length: 10 } })).toBe(true);
    expect(isAbiList("uint128")).toBe(false);
    expect(isAbiList({ tuple: [] })).toBe(false);
  });

  it("should identify tuple types", () => {
    expect(isAbiTuple({ tuple: [{ name: "id", type: "uint128" }] })).toBe(true);
    expect(isAbiTuple("uint128")).toBe(false);
  });

  it("should identify optional types", () => {
    expect(isAbiOptional({ optional: "uint128" })).toBe(true);
    expect(isAbiOptional("uint128")).toBe(false);
  });

  it("should identify response types", () => {
    expect(isAbiResponse({ response: { ok: "bool", error: "uint128" } })).toBe(true);
    expect(isAbiResponse("uint128")).toBe(false);
  });

  it("should identify buffer types", () => {
    expect(isAbiBuffer({ buff: { length: 32 } })).toBe(true);
    expect(isAbiBuffer("uint128")).toBe(false);
  });

  it("should identify string-ascii types", () => {
    expect(isAbiStringAscii({ "string-ascii": { length: 100 } })).toBe(true);
    expect(isAbiStringAscii("uint128")).toBe(false);
  });

  it("should identify string-utf8 types", () => {
    expect(isAbiStringUtf8({ "string-utf8": { length: 100 } })).toBe(true);
    expect(isAbiStringUtf8("uint128")).toBe(false);
  });

  it("should identify trait_reference types", () => {
    expect(isAbiTraitReference("trait_reference")).toBe(true);
    expect(isAbiTraitReference("uint128")).toBe(false);
    expect(isAbiTraitReference("principal")).toBe(false);
  });
});

describe("isTraitReference", () => {
  it("should validate trait references (contract principals)", () => {
    expect(isTraitReference("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-trait")).toBe(true);
    expect(isTraitReference("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG.test-trait")).toBe(true);
  });

  it("should reject standard principals", () => {
    expect(isTraitReference("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(false);
  });

  it("should reject invalid values", () => {
    expect(isTraitReference("invalid")).toBe(false);
    expect(isTraitReference(null)).toBe(false);
    expect(isTraitReference(123)).toBe(false);
  });
});
