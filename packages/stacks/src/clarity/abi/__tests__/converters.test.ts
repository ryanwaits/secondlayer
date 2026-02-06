import { describe, it, expect } from "bun:test";
import {
  jsToClarity,
  prepareArgs,
  validateArgs,
  ClarityConversionError,
} from "../converters.ts";
import { toCamelCase } from "../utils.ts";

describe("jsToClarity", () => {
  it("should validate and pass through primitives", () => {
    expect(jsToClarity("uint128", 123n)).toBe(123n);
    expect(jsToClarity("int128", -123n)).toBe(-123n);
    expect(jsToClarity("bool", true)).toBe(true);
    expect(jsToClarity("principal", "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(
      "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    );
  });

  it("should throw on invalid primitives", () => {
    expect(() => jsToClarity("uint128", -1n)).toThrow(ClarityConversionError);
    expect(() => jsToClarity("bool", "true" as any)).toThrow(ClarityConversionError);
    expect(() => jsToClarity("principal", "invalid" as any)).toThrow(ClarityConversionError);
  });

  it("should validate string lengths", () => {
    const shortString = { "string-ascii": { length: 5 } } as const;
    expect(jsToClarity(shortString, "hello")).toBe("hello");
    expect(() => jsToClarity(shortString, "too long")).toThrow(ClarityConversionError);

    const utf8String = { "string-utf8": { length: 5 } } as const;
    expect(jsToClarity(utf8String, "hello")).toBe("hello");
    expect(() => jsToClarity(utf8String, "🎉🎉🎉")).toThrow(ClarityConversionError);
  });

  it("should validate buffer lengths", () => {
    const buff = { buff: { length: 4 } } as const;
    const validBuffer = new Uint8Array([1, 2, 3, 4]);
    const invalidBuffer = new Uint8Array([1, 2, 3, 4, 5]);
    expect(jsToClarity(buff, validBuffer)).toBe(validBuffer);
    expect(() => jsToClarity(buff, invalidBuffer)).toThrow(ClarityConversionError);
  });
});

describe("Composite type conversion", () => {
  describe("List types", () => {
    const listType = { list: { type: "uint128" as const, length: 5 } };

    it("should validate list with correct elements", () => {
      expect(jsToClarity(listType, [1n, 2n, 3n])).toEqual([1n, 2n, 3n]);
    });

    it("should validate empty list", () => {
      expect(jsToClarity(listType, [])).toEqual([]);
    });

    it("should throw on list exceeding max length", () => {
      expect(() => jsToClarity(listType, [1n, 2n, 3n, 4n, 5n, 6n])).toThrow(/exceeds max/);
    });

    it("should throw on invalid list elements", () => {
      expect(() => jsToClarity(listType, [1n, -1n, 3n])).toThrow(ClarityConversionError);
    });

    it("should throw when value is not an array", () => {
      expect(() => jsToClarity(listType, "not an array")).toThrow(ClarityConversionError);
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
      const result = jsToClarity(kebabTupleType, { userId: 42n, isActive: true });
      expect(result).toEqual({ "user-id": 42n, "is-active": true });
    });

    it("should throw on missing tuple fields", () => {
      expect(() => jsToClarity(tupleType, { amount: 100n })).toThrow(/Missing tuple field/);
    });

    it("should throw on invalid tuple field values", () => {
      expect(() =>
        jsToClarity(tupleType, {
          amount: -100n,
          recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        }),
      ).toThrow(ClarityConversionError);
    });

    it("should throw when value is not an object", () => {
      expect(() => jsToClarity(tupleType, "not an object")).toThrow(ClarityConversionError);
      expect(() => jsToClarity(tupleType, null)).toThrow(ClarityConversionError);
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
      expect(() => jsToClarity(optionalType, -100n)).toThrow(ClarityConversionError);
    });
  });

  describe("Response types", () => {
    const responseType = {
      response: { ok: "bool" as const, error: "uint128" as const },
    };

    it("should validate ok response", () => {
      expect(jsToClarity(responseType, { ok: true })).toEqual({ ok: true });
    });

    it("should validate err response", () => {
      expect(jsToClarity(responseType, { err: 100n })).toEqual({ err: 100n });
    });

    it("should throw on invalid ok value", () => {
      expect(() => jsToClarity(responseType, { ok: "not a bool" })).toThrow(ClarityConversionError);
    });

    it("should throw on invalid err value", () => {
      expect(() => jsToClarity(responseType, { err: -100n })).toThrow(ClarityConversionError);
    });

    it("should throw when response has both ok and err", () => {
      expect(() => jsToClarity(responseType, { ok: true, err: 100n })).toThrow(/exactly 'ok' or 'err'/);
    });

    it("should throw when response has neither ok nor err", () => {
      expect(() => jsToClarity(responseType, {})).toThrow(ClarityConversionError);
    });

    it("should throw when value is not an object", () => {
      expect(() => jsToClarity(responseType, "not an object")).toThrow(ClarityConversionError);
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
    const result = prepareArgs(testFunction, {
      id: 123n,
      owner: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    });
    expect(result).toEqual([123n, "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7"]);
  });

  it("should throw on missing arguments", () => {
    expect(() => prepareArgs(testFunction, { id: 123n })).toThrow("Missing argument: owner");
  });

  it("should throw on invalid arguments", () => {
    expect(() =>
      prepareArgs(testFunction, {
        id: -1n,
        owner: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      }),
    ).toThrow(ClarityConversionError);
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
    expect(() => validateArgs(testFunction, { amount: -100n })).toThrow(ClarityConversionError);
    expect(() => validateArgs(testFunction, {})).toThrow("Missing argument: amount");
  });
});

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
