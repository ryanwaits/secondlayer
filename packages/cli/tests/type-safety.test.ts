import { describe, it, expect } from "vitest";
import { clarityTypeToTS } from "../src/plugins/react/generators/utils";

describe("Type Safety - clarityTypeToTS", () => {
  describe("Primitive Types", () => {
    it("handles uint128 type", () => {
      expect(clarityTypeToTS("uint128")).toBe("bigint");
    });

    it("handles int128 type", () => {
      expect(clarityTypeToTS("int128")).toBe("bigint");
    });

    it("handles principal type", () => {
      expect(clarityTypeToTS("principal")).toBe("string");
    });

    it("handles bool type", () => {
      expect(clarityTypeToTS("bool")).toBe("boolean");
    });

    it("handles string types", () => {
      expect(clarityTypeToTS("string-ascii")).toBe("string");
      expect(clarityTypeToTS("string-utf8")).toBe("string");
      expect(clarityTypeToTS({ "string-ascii": { length: 100 } })).toBe("string");
      expect(clarityTypeToTS({ "string-utf8": { length: 100 } })).toBe("string");
    });

    it("handles buffer type", () => {
      // Shorthand string format
      expect(clarityTypeToTS("buff")).toBe("Uint8Array | string | { type: 'ascii' | 'utf8' | 'hex'; value: string }");
      // Full object format from ABI
      expect(clarityTypeToTS({ buff: { length: 32 } })).toBe("Uint8Array | string | { type: 'ascii' | 'utf8' | 'hex'; value: string }");
    });
  });

  describe("Response Types", () => {
    it("handles simple response types", () => {
      const responseType = {
        response: {
          ok: "uint128",
          error: "uint128",
        },
      };

      expect(clarityTypeToTS(responseType)).toBe(
        "{ ok: bigint } | { err: bigint }"
      );
    });

    it("handles response with bool ok type", () => {
      const responseType = {
        response: {
          ok: "bool",
          error: "uint128",
        },
      };

      expect(clarityTypeToTS(responseType)).toBe(
        "{ ok: boolean } | { err: bigint }"
      );
    });

    it("handles nested response types with tuple ok", () => {
      const responseType = {
        response: {
          ok: {
            tuple: [
              { name: "balance", type: "uint128" },
              { name: "owner", type: "principal" },
            ],
          },
          error: "uint128",
        },
      };

      expect(clarityTypeToTS(responseType)).toBe(
        "{ ok: { balance: bigint; owner: string } } | { err: bigint }"
      );
    });
  });

  describe("Tuple Types", () => {
    it("handles simple tuple types", () => {
      const tupleType = {
        tuple: [
          { name: "owner", type: "principal" },
          { name: "amount", type: "uint128" },
        ],
      };

      expect(clarityTypeToTS(tupleType)).toBe(
        "{ owner: string; amount: bigint }"
      );
    });

    it("handles tuple with hyphenated names (converts to camelCase)", () => {
      const tupleType = {
        tuple: [
          { name: "total-supply", type: "uint128" },
          { name: "token-name", type: { "string-ascii": { length: 32 } } },
        ],
      };

      expect(clarityTypeToTS(tupleType)).toBe(
        "{ totalSupply: bigint; tokenName: string }"
      );
    });

    it("handles nested tuples", () => {
      const tupleType = {
        tuple: [
          { name: "id", type: "uint128" },
          {
            name: "metadata",
            type: {
              tuple: [
                { name: "name", type: { "string-utf8": { length: 50 } } },
                { name: "value", type: "uint128" },
              ],
            },
          },
        ],
      };

      expect(clarityTypeToTS(tupleType)).toBe(
        "{ id: bigint; metadata: { name: string; value: bigint } }"
      );
    });
  });

  describe("List Types", () => {
    it("handles simple list types", () => {
      const listType = {
        list: {
          type: "uint128",
          length: 100,
        },
      };

      expect(clarityTypeToTS(listType)).toBe("bigint[]");
    });

    it("handles list of principals", () => {
      const listType = {
        list: {
          type: "principal",
          length: 50,
        },
      };

      expect(clarityTypeToTS(listType)).toBe("string[]");
    });

    it("handles list of tuples", () => {
      const listType = {
        list: {
          type: {
            tuple: [
              { name: "id", type: "uint128" },
              { name: "owner", type: "principal" },
            ],
          },
          length: 10,
        },
      };

      expect(clarityTypeToTS(listType)).toBe(
        "{ id: bigint; owner: string }[]"
      );
    });
  });

  describe("Optional Types", () => {
    it("handles optional primitive types", () => {
      const optionalType = {
        optional: "uint128",
      };

      expect(clarityTypeToTS(optionalType)).toBe("bigint | null");
    });

    it("handles optional tuple types", () => {
      const optionalType = {
        optional: {
          tuple: [
            { name: "balance", type: "uint128" },
            { name: "locked", type: "bool" },
          ],
        },
      };

      expect(clarityTypeToTS(optionalType)).toBe(
        "{ balance: bigint; locked: boolean } | null"
      );
    });
  });

  describe("Complex Nested Types", () => {
    it("handles deeply nested types", () => {
      const complexType = {
        response: {
          ok: {
            list: {
              type: {
                tuple: [
                  { name: "id", type: "uint128" },
                  { name: "owner", type: "principal" },
                ],
              },
              length: 50,
            },
          },
          error: "uint128",
        },
      };

      expect(clarityTypeToTS(complexType)).toBe(
        "{ ok: { id: bigint; owner: string }[] } | { err: bigint }"
      );
    });

    it("handles response with optional in tuple", () => {
      const complexType = {
        response: {
          ok: {
            tuple: [
              { name: "amount", type: "uint128" },
              { name: "memo", type: { optional: { "string-utf8": { length: 100 } } } },
            ],
          },
          error: "uint128",
        },
      };

      expect(clarityTypeToTS(complexType)).toBe(
        "{ ok: { amount: bigint; memo: string | null } } | { err: bigint }"
      );
    });

    it("handles list of optionals", () => {
      const listType = {
        list: {
          type: {
            optional: "principal",
          },
          length: 20,
        },
      };

      expect(clarityTypeToTS(listType)).toBe("(string | null)[]");
    });
  });

  describe("Edge Cases", () => {
    it("returns any for unknown types", () => {
      expect(clarityTypeToTS("unknown-type")).toBe("any");
      expect(clarityTypeToTS({ unknownProperty: true })).toBe("any");
    });

    it("handles empty tuple", () => {
      const emptyTuple = {
        tuple: [],
      };

      expect(clarityTypeToTS(emptyTuple)).toBe("{  }");
    });
  });
});
