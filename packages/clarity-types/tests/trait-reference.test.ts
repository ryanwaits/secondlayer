import { describe, it, expect } from "bun:test";
import { jsToClarity } from "../src/converters";
import type { ClarityToTS } from "../src/types/mappings";
import type { ClarityContract, ExtractFunctionArgs } from "../src";

describe("trait_reference support", () => {
  it("should handle trait_reference type correctly in type system", () => {
    // Test the type mapping
    type TraitRefType = ClarityToTS<"trait_reference">;
    const value: TraitRefType =
      "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.my-trait";
    expect(typeof value).toBe("string");
  });

  it("should validate trait_reference values in jsToClarity", () => {
    const validContractPrincipal =
      "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.my-trait";
    const validStandardPrincipal = "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9";

    expect(() =>
      jsToClarity("trait_reference", validContractPrincipal)
    ).not.toThrow();
    expect(() =>
      jsToClarity("trait_reference", validStandardPrincipal)
    ).not.toThrow();

    expect(() => jsToClarity("trait_reference", "invalid-principal")).toThrow();
    expect(() => jsToClarity("trait_reference", 123)).toThrow();
  });

  it("should work with contract ABI extraction", () => {
    const contractAbi = {
      functions: [
        {
          name: "get-balance-of",
          access: "public" as const,
          args: [{ name: "assetContract", type: "trait_reference" as const }],
          outputs: {
            response: {
              ok: "uint128" as const,
              error: "uint128" as const,
            },
          } as const,
        },
      ],
    } as const satisfies ClarityContract;

    type Args = ExtractFunctionArgs<typeof contractAbi, "get-balance-of">;

    // This should infer { assetContract: string }
    const args: Args = {
      assetContract: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.my-token",
    };

    expect(typeof args.assetContract).toBe("string");
  });
});
