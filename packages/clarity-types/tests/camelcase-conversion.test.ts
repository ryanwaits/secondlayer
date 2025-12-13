import { describe, it } from "vitest";
import { expectTypeOf } from "vitest";
import type { ClarityToTS } from "../src/types/mappings";
import type { ClarityContract, ExtractFunctionArgs } from "../src";

describe("CamelCase conversion for hyphenated names", () => {
  it("should convert hyphenated tuple field names to camelCase", () => {
    type PriceFunctionTuple = ClarityToTS<{
      tuple: [
        { name: "base"; type: "uint128" },
        { name: "buckets"; type: { list: { type: "uint128"; length: 16 } } },
        { name: "coeff"; type: "uint128" },
        { name: "no-vowel-discount"; type: "uint128" },
        { name: "nonalpha-discount"; type: "uint128" }
      ];
    }>;

    // Should convert hyphenated names to camelCase
    expectTypeOf<PriceFunctionTuple>().toEqualTypeOf<{
      base: bigint;
      buckets: bigint[];
      coeff: bigint;
      noVowelDiscount: bigint; // no-vowel-discount -> noVowelDiscount
      nonalphaDiscount: bigint; // nonalpha-discount -> nonalphaDiscount
    }>();
  });

  it("should convert hyphenated function argument names to camelCase", () => {
    const contractAbi = {
      functions: [
        {
          name: "test-function",
          access: "public" as const,
          args: [
            { name: "user-id", type: "uint128" as const },
            { name: "asset-contract", type: "trait_reference" as const },
            { name: "no-vowel-discount", type: "uint128" as const },
            { name: "multi-word-arg", type: "bool" as const },
          ],
          outputs: {
            response: { ok: "bool" as const, error: "uint128" as const },
          } as const,
        },
      ],
    } as const satisfies ClarityContract;

    type Args = ExtractFunctionArgs<typeof contractAbi, "test-function">;

    // Should convert hyphenated argument names to camelCase
    expectTypeOf<Args>().toEqualTypeOf<{
      userId: bigint; // user-id -> userId
      assetContract: string; // asset-contract -> assetContract
      noVowelDiscount: bigint; // no-vowel-discount -> noVowelDiscount
      multiWordArg: boolean; // multi-word-arg -> multiWordArg
    }>();
  });

  it("should handle nested tuples with hyphenated names", () => {
    type ComplexType = ClarityToTS<{
      tuple: [
        { name: "simple-field"; type: "uint128" },
        {
          name: "nested-data";
          type: {
            tuple: [
              { name: "inner-value"; type: "bool" },
              { name: "another-field"; type: "principal" }
            ];
          };
        }
      ];
    }>;

    expectTypeOf<ComplexType>().toEqualTypeOf<{
      simpleField: bigint; // simple-field -> simpleField
      nestedData: {
        // nested-data -> nestedData
        innerValue: boolean; // inner-value -> innerValue
        anotherField: string; // another-field -> anotherField
      };
    }>();
  });

  it("should preserve non-hyphenated names unchanged", () => {
    type MixedTuple = ClarityToTS<{
      tuple: [
        { name: "normal"; type: "uint128" },
        { name: "camelCase"; type: "bool" },
        { name: "with-hyphens"; type: "principal" },
        { name: "PascalCase"; type: "uint128" }
      ];
    }>;

    expectTypeOf<MixedTuple>().toEqualTypeOf<{
      normal: bigint; // unchanged
      camelCase: boolean; // unchanged
      withHyphens: string; // with-hyphens -> withHyphens
      PascalCase: bigint; // unchanged
    }>();
  });
});
