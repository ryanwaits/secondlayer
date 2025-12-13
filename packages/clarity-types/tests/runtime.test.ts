import { describe, it, expect } from "vitest";
import {
  isUint128,
  isInt128,
  isBool,
  isPrincipal,
  isStandardPrincipal,
  isContractPrincipal,
  isOkResponse,
  isErrResponse,
  isResponse,
  isArray,
  isOptional,
  jsToClarity,
  prepareArgs,
  validateArgs,
  ClarityConversionError,
  MAX_U128,
  MIN_I128,
  MAX_I128,
} from "../src";

describe("Type Guards", () => {
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
    it("should validate standard principals", () => {
      expect(isPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(
        true
      );
      expect(
        isStandardPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).toBe(true);
      expect(
        isContractPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).toBe(false);
    });

    it("should validate contract principals", () => {
      const contractPrincipal =
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract";
      expect(isPrincipal(contractPrincipal)).toBe(true);
      expect(isStandardPrincipal(contractPrincipal)).toBe(false);
      expect(isContractPrincipal(contractPrincipal)).toBe(true);
    });

    it("should reject invalid principals", () => {
      expect(isPrincipal("invalid")).toBe(false);
      expect(isPrincipal("SP123")).toBe(false);
      expect(isPrincipal("")).toBe(false);
      expect(isPrincipal(null)).toBe(false);
    });
  });

  describe("Response type guards", () => {
    it("should identify ok responses", () => {
      const okResponse = { ok: true };
      const errResponse = { err: "error" };

      expect(isOkResponse(okResponse)).toBe(true);
      expect(isOkResponse(errResponse)).toBe(false);
      expect(isErrResponse(okResponse)).toBe(false);
      expect(isErrResponse(errResponse)).toBe(true);
    });

    it("should validate response with guards", () => {
      const okResponse = { ok: 123n };
      const errResponse = { err: "error" };

      expect(
        isResponse(
          okResponse,
          isUint128,
          (v): v is string => typeof v === "string"
        )
      ).toBe(true);
      expect(
        isResponse(
          errResponse,
          isUint128,
          (v): v is string => typeof v === "string"
        )
      ).toBe(true);
      expect(
        isResponse(
          { ok: "invalid" },
          isUint128,
          (v): v is string => typeof v === "string"
        )
      ).toBe(false);
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

describe("Value Converters", () => {
  describe("jsToClarity", () => {
    it("should validate and pass through primitives", () => {
      expect(jsToClarity("uint128", 123n)).toBe(123n);
      expect(jsToClarity("int128", -123n)).toBe(-123n);
      expect(jsToClarity("bool", true)).toBe(true);
      expect(
        jsToClarity("principal", "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")
      ).toBe("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7");
    });

    it("should throw on invalid primitives", () => {
      expect(() => jsToClarity("uint128", -1n)).toThrow(ClarityConversionError);
      expect(() => jsToClarity("bool", "true" as any)).toThrow(
        ClarityConversionError
      );
      expect(() => jsToClarity("principal", "invalid" as any)).toThrow(
        ClarityConversionError
      );
    });

    it("should validate string lengths", () => {
      const shortString = { "string-ascii": { length: 5 } } as const;
      expect(jsToClarity(shortString, "hello")).toBe("hello");
      expect(() => jsToClarity(shortString, "too long")).toThrow(
        ClarityConversionError
      );

      const utf8String = { "string-utf8": { length: 5 } } as const;
      expect(jsToClarity(utf8String, "hello")).toBe("hello");
      expect(() => jsToClarity(utf8String, "🎉🎉🎉")).toThrow(
        ClarityConversionError
      ); // 12 bytes
    });

    it("should validate buffer lengths", () => {
      const buff = { buff: { length: 4 } } as const;
      const validBuffer = new Uint8Array([1, 2, 3, 4]);
      const invalidBuffer = new Uint8Array([1, 2, 3, 4, 5]);

      expect(jsToClarity(buff, validBuffer)).toBe(validBuffer);
      expect(() => jsToClarity(buff, invalidBuffer)).toThrow(
        ClarityConversionError
      );
    });
  });

  describe("prepareArgs", () => {
    const testFunction = {
      name: "test",
      access: "public" as const,
      args: [
        { name: "id", type: "uint128" as const },
        { name: "owner", type: "principal" as const },
      ],
      outputs: "bool" as const,
    };

    it("should prepare valid arguments", () => {
      const args = {
        id: 123n,
        owner: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      };

      const prepared = prepareArgs(testFunction, args);
      expect(prepared).toEqual([
        123n,
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      ]);
    });

    it("should throw on missing arguments", () => {
      const args = { id: 123n };
      expect(() => prepareArgs(testFunction, args)).toThrow(
        "Missing argument: owner"
      );
    });

    it("should throw on invalid arguments", () => {
      const args = {
        id: -1n,
        owner: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      };
      expect(() => prepareArgs(testFunction, args)).toThrow(
        ClarityConversionError
      );
    });
  });

  describe("validateArgs", () => {
    const testFunction = {
      name: "test",
      access: "public" as const,
      args: [{ name: "amount", type: "uint128" as const }],
      outputs: "bool" as const,
    };

    it("should validate correct arguments", () => {
      expect(() => validateArgs(testFunction, { amount: 100n })).not.toThrow();
    });

    it("should throw on invalid arguments", () => {
      expect(() => validateArgs(testFunction, { amount: -100n })).toThrow(
        ClarityConversionError
      );
      expect(() => validateArgs(testFunction, {})).toThrow(
        "Missing argument: amount"
      );
    });
  });
});
