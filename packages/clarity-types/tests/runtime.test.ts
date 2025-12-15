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
  isClarityList,
  isClarityTuple,
  isClarityOptional,
  isClarityResponse,
  isClarityBuffer,
  isClarityStringAscii,
  isClarityStringUtf8,
  jsToClarity,
  prepareArgs,
  validateArgs,
  ClarityConversionError,
  MAX_U128,
  MIN_I128,
  MAX_I128,
  toCamelCase,
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

  describe("Principal validation with @stacks/transactions", () => {
    it("should validate mainnet standard principals", () => {
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

    it("should validate testnet principals (ST prefix)", () => {
      // Testnet addresses start with ST
      expect(isPrincipal("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")).toBe(
        true
      );
      expect(
        isStandardPrincipal("ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG")
      ).toBe(true);
    });

    it("should validate contract principals", () => {
      const contractPrincipal =
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.my-contract";
      expect(isPrincipal(contractPrincipal)).toBe(true);
      expect(isStandardPrincipal(contractPrincipal)).toBe(false);
      expect(isContractPrincipal(contractPrincipal)).toBe(true);
    });

    it("should validate testnet contract principals", () => {
      const testnetContract =
        "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG.test-contract";
      expect(isPrincipal(testnetContract)).toBe(true);
      expect(isContractPrincipal(testnetContract)).toBe(true);
    });

    it("should reject invalid principals", () => {
      expect(isPrincipal("invalid")).toBe(false);
      expect(isPrincipal("SP123")).toBe(false);
      expect(isPrincipal("")).toBe(false);
      expect(isPrincipal(null)).toBe(false);
    });

    it("should reject principals with invalid checksums", () => {
      // Modified last character to create invalid checksum
      expect(isPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ8")).toBe(
        false
      );
    });

    it("should reject contract principals with invalid contract names", () => {
      // Contract name must start with a letter
      expect(
        isContractPrincipal(
          "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.123invalid"
        )
      ).toBe(false);
      // Contract name can't be empty
      expect(
        isContractPrincipal("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.")
      ).toBe(false);
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

  describe("Composite type conversion", () => {
    describe("List types", () => {
      const listType = { list: { type: "uint128" as const, length: 5 } };

      it("should validate list with correct elements", () => {
        const result = jsToClarity(listType, [1n, 2n, 3n]);
        expect(result).toEqual([1n, 2n, 3n]);
      });

      it("should validate empty list", () => {
        const result = jsToClarity(listType, []);
        expect(result).toEqual([]);
      });

      it("should throw on list exceeding max length", () => {
        expect(() => jsToClarity(listType, [1n, 2n, 3n, 4n, 5n, 6n])).toThrow(
          ClarityConversionError
        );
        expect(() => jsToClarity(listType, [1n, 2n, 3n, 4n, 5n, 6n])).toThrow(
          /exceeds max/
        );
      });

      it("should throw on invalid list elements", () => {
        expect(() => jsToClarity(listType, [1n, -1n, 3n])).toThrow(
          ClarityConversionError
        );
      });

      it("should throw when value is not an array", () => {
        expect(() => jsToClarity(listType, "not an array")).toThrow(
          ClarityConversionError
        );
      });
    });

    describe("Tuple types", () => {
      const tupleType = {
        tuple: [
          { name: "amount", type: "uint128" as const },
          { name: "recipient", type: "principal" as const },
        ],
      };

      it("should validate tuple with correct fields", () => {
        const result = jsToClarity(tupleType, {
          amount: 100n,
          recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        });
        expect(result).toEqual({
          amount: 100n,
          recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        });
      });

      it("should accept camelCase field names for kebab-case definitions", () => {
        const kebabTupleType = {
          tuple: [
            { name: "user-id", type: "uint128" as const },
            { name: "is-active", type: "bool" as const },
          ],
        };
        const result = jsToClarity(kebabTupleType, {
          userId: 42n,
          isActive: true,
        });
        expect(result).toEqual({
          "user-id": 42n,
          "is-active": true,
        });
      });

      it("should throw on missing tuple fields", () => {
        expect(() => jsToClarity(tupleType, { amount: 100n })).toThrow(
          ClarityConversionError
        );
        expect(() => jsToClarity(tupleType, { amount: 100n })).toThrow(
          /Missing tuple field/
        );
      });

      it("should throw on invalid tuple field values", () => {
        expect(() =>
          jsToClarity(tupleType, {
            amount: -100n,
            recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
          })
        ).toThrow(ClarityConversionError);
      });

      it("should throw when value is not an object", () => {
        expect(() => jsToClarity(tupleType, "not an object")).toThrow(
          ClarityConversionError
        );
        expect(() => jsToClarity(tupleType, null)).toThrow(
          ClarityConversionError
        );
      });
    });

    describe("Optional types", () => {
      const optionalType = { optional: "uint128" as const };

      it("should convert null to null", () => {
        expect(jsToClarity(optionalType, null)).toBe(null);
      });

      it("should convert undefined to null", () => {
        expect(jsToClarity(optionalType, undefined)).toBe(null);
      });

      it("should validate present value", () => {
        expect(jsToClarity(optionalType, 100n)).toBe(100n);
      });

      it("should throw on invalid present value", () => {
        expect(() => jsToClarity(optionalType, -100n)).toThrow(
          ClarityConversionError
        );
      });
    });

    describe("Response types", () => {
      const responseType = {
        response: { ok: "bool" as const, error: "uint128" as const },
      };

      it("should validate ok response", () => {
        const result = jsToClarity(responseType, { ok: true });
        expect(result).toEqual({ ok: true });
      });

      it("should validate err response", () => {
        const result = jsToClarity(responseType, { err: 100n });
        expect(result).toEqual({ err: 100n });
      });

      it("should throw on invalid ok value", () => {
        expect(() => jsToClarity(responseType, { ok: "not a bool" })).toThrow(
          ClarityConversionError
        );
      });

      it("should throw on invalid err value", () => {
        expect(() => jsToClarity(responseType, { err: -100n })).toThrow(
          ClarityConversionError
        );
      });

      it("should throw when response has both ok and err", () => {
        expect(() =>
          jsToClarity(responseType, { ok: true, err: 100n })
        ).toThrow(ClarityConversionError);
        expect(() =>
          jsToClarity(responseType, { ok: true, err: 100n })
        ).toThrow(/exactly 'ok' or 'err'/);
      });

      it("should throw when response has neither ok nor err", () => {
        expect(() => jsToClarity(responseType, {})).toThrow(
          ClarityConversionError
        );
      });

      it("should throw when value is not an object", () => {
        expect(() => jsToClarity(responseType, "not an object")).toThrow(
          ClarityConversionError
        );
      });
    });

    describe("Nested composite types", () => {
      it("should validate list of tuples", () => {
        const listOfTuples = {
          list: {
            type: {
              tuple: [
                { name: "id", type: "uint128" as const },
                { name: "active", type: "bool" as const },
              ],
            },
            length: 10,
          },
        };

        const result = jsToClarity(listOfTuples, [
          { id: 1n, active: true },
          { id: 2n, active: false },
        ]);
        expect(result).toEqual([
          { id: 1n, active: true },
          { id: 2n, active: false },
        ]);
      });

      it("should validate optional list", () => {
        const optionalList = {
          optional: { list: { type: "uint128" as const, length: 5 } },
        };

        expect(jsToClarity(optionalList, null)).toBe(null);
        expect(jsToClarity(optionalList, [1n, 2n])).toEqual([1n, 2n]);
      });

      it("should validate response with tuple ok type", () => {
        const responseWithTuple = {
          response: {
            ok: {
              tuple: [
                { name: "balance", type: "uint128" as const },
                { name: "owner", type: "principal" as const },
              ],
            },
            error: "uint128" as const,
          },
        };

        const result = jsToClarity(responseWithTuple, {
          ok: {
            balance: 1000n,
            owner: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
          },
        });
        expect(result).toEqual({
          ok: {
            balance: 1000n,
            owner: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
          },
        });
      });
    });
  });
});

describe("Clarity ABI Type Guards", () => {
  it("should identify list types", () => {
    expect(isClarityList({ list: { type: "uint128", length: 10 } })).toBe(true);
    expect(isClarityList("uint128")).toBe(false);
    expect(isClarityList({ tuple: [] })).toBe(false);
  });

  it("should identify tuple types", () => {
    expect(
      isClarityTuple({ tuple: [{ name: "id", type: "uint128" }] })
    ).toBe(true);
    expect(isClarityTuple("uint128")).toBe(false);
    expect(isClarityTuple({ list: { type: "uint128", length: 10 } })).toBe(
      false
    );
  });

  it("should identify optional types", () => {
    expect(isClarityOptional({ optional: "uint128" })).toBe(true);
    expect(isClarityOptional("uint128")).toBe(false);
    expect(isClarityOptional({ response: { ok: "bool", error: "uint128" } })).toBe(
      false
    );
  });

  it("should identify response types", () => {
    expect(
      isClarityResponse({ response: { ok: "bool", error: "uint128" } })
    ).toBe(true);
    expect(isClarityResponse("uint128")).toBe(false);
    expect(isClarityResponse({ optional: "uint128" })).toBe(false);
  });

  it("should identify buffer types", () => {
    expect(isClarityBuffer({ buff: { length: 32 } })).toBe(true);
    expect(isClarityBuffer("uint128")).toBe(false);
    expect(isClarityBuffer({ "string-ascii": { length: 10 } })).toBe(false);
  });

  it("should identify string-ascii types", () => {
    expect(isClarityStringAscii({ "string-ascii": { length: 100 } })).toBe(true);
    expect(isClarityStringAscii("uint128")).toBe(false);
    expect(isClarityStringAscii({ "string-utf8": { length: 100 } })).toBe(false);
  });

  it("should identify string-utf8 types", () => {
    expect(isClarityStringUtf8({ "string-utf8": { length: 100 } })).toBe(true);
    expect(isClarityStringUtf8("uint128")).toBe(false);
    expect(isClarityStringUtf8({ "string-ascii": { length: 100 } })).toBe(false);
  });
});

describe("Utilities", () => {
  describe("toCamelCase", () => {
    it("should convert kebab-case to camelCase", () => {
      expect(toCamelCase("user-id")).toBe("userId");
      expect(toCamelCase("is-active")).toBe("isActive");
      expect(toCamelCase("token-balance")).toBe("tokenBalance");
    });

    it("should handle multiple hyphens", () => {
      expect(toCamelCase("get-user-by-id")).toBe("getUserById");
    });

    it("should not change strings without hyphens", () => {
      expect(toCamelCase("amount")).toBe("amount");
      expect(toCamelCase("userBalance")).toBe("userBalance");
    });

    it("should handle empty strings", () => {
      expect(toCamelCase("")).toBe("");
    });
  });
});
