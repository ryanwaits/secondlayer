import { describe, it, expectTypeOf } from "vitest";
import type {
  ClarityToTS,
  ClarityContract,
  ExtractFunctionNames,
  ExtractFunctionArgs,
  ExtractFunctionOutput,
  ContractInterface,
} from "../src";

/**
 * Type-level tests for clarity-types
 */

describe("Type Inference", () => {
  it("should infer primitive types correctly", () => {
    // Numeric types
    type TestUint = ClarityToTS<"uint128">;
    expectTypeOf<TestUint>().toEqualTypeOf<bigint>();

    type TestInt = ClarityToTS<"int128">;
    expectTypeOf<TestInt>().toEqualTypeOf<bigint>();

    // Boolean
    type TestBool = ClarityToTS<"bool">;
    expectTypeOf<TestBool>().toEqualTypeOf<boolean>();

    // Principal
    type TestPrincipal = ClarityToTS<"principal">;
    expectTypeOf<TestPrincipal>().toEqualTypeOf<string>();
  });

  it("should infer string types correctly", () => {
    type TestAscii = ClarityToTS<{ "string-ascii": { length: 50 } }>;
    expectTypeOf<TestAscii>().toEqualTypeOf<string>();

    type TestUtf8 = ClarityToTS<{ "string-utf8": { length: 100 } }>;
    expectTypeOf<TestUtf8>().toEqualTypeOf<string>();
  });

  it("should infer buffer types correctly", () => {
    type TestBuffer = ClarityToTS<{ buff: { length: 32 } }>;
    expectTypeOf<TestBuffer>().toEqualTypeOf<Uint8Array>();
  });

  it("should infer optional types correctly", () => {
    type TestOptional = ClarityToTS<{ optional: "uint128" }>;
    expectTypeOf<TestOptional>().toEqualTypeOf<bigint | null>();

    type TestOptionalString = ClarityToTS<{
      optional: { "string-ascii": { length: 10 } };
    }>;
    expectTypeOf<TestOptionalString>().toEqualTypeOf<string | null>();
  });

  it("should infer response types correctly", () => {
    type TestResponse = ClarityToTS<{
      response: {
        ok: "bool";
        error: "uint128";
      };
    }>;
    expectTypeOf<TestResponse>().toEqualTypeOf<
      { ok: boolean } | { err: bigint }
    >();
  });

  it("should infer list types correctly", () => {
    type TestList = ClarityToTS<{
      list: {
        type: "uint128";
        length: 10;
      };
    }>;
    expectTypeOf<TestList>().toEqualTypeOf<bigint[]>();
  });

  it("should infer tuple types correctly", () => {
    type TestTuple = ClarityToTS<{
      tuple: [
        { name: "id"; type: "uint128" },
        { name: "owner"; type: "principal" },
        { name: "active"; type: "bool" }
      ];
    }>;
    expectTypeOf<TestTuple>().toEqualTypeOf<{
      id: bigint;
      owner: string;
      active: boolean;
    }>();
  });
});

describe("Contract Type Extraction", () => {
  // Test contract
  const testContract = {
    functions: [
      {
        name: "transfer",
        access: "public",
        args: [
          { name: "id", type: "uint128" },
          { name: "sender", type: "principal" },
          { name: "recipient", type: "principal" },
        ],
        outputs: {
          response: {
            ok: "bool",
            error: "uint128",
          },
        },
      },
      {
        name: "get-owner",
        access: "read-only",
        args: [{ name: "id", type: "uint128" }],
        outputs: {
          optional: "principal",
        },
      },
      {
        name: "mint",
        access: "public",
        args: [
          { name: "recipient", type: "principal" },
          {
            name: "metadata",
            type: {
              tuple: [
                { name: "uri", type: { "string-ascii": { length: 256 } } },
                { name: "name", type: { "string-utf8": { length: 50 } } },
              ],
            },
          },
        ],
        outputs: {
          response: {
            ok: "uint128",
            error: "uint128",
          },
        },
      },
    ],
  } as const satisfies ClarityContract;

  it("should extract function names", () => {
    type FunctionNames = ExtractFunctionNames<typeof testContract>;
    expectTypeOf<FunctionNames>().toEqualTypeOf<
      "transfer" | "get-owner" | "mint"
    >();
  });

  it("should extract function arguments", () => {
    type TransferArgs = ExtractFunctionArgs<typeof testContract, "transfer">;
    expectTypeOf<TransferArgs>().toEqualTypeOf<{
      id: bigint;
      sender: string;
      recipient: string;
    }>();

    type MintArgs = ExtractFunctionArgs<typeof testContract, "mint">;
    expectTypeOf<MintArgs>().toEqualTypeOf<{
      recipient: string;
      metadata: {
        uri: string;
        name: string;
      };
    }>();
  });

  it("should extract function outputs", () => {
    type TransferOutput = ExtractFunctionOutput<
      typeof testContract,
      "transfer"
    >;
    expectTypeOf<TransferOutput>().toEqualTypeOf<
      { ok: boolean } | { err: bigint }
    >();

    type GetOwnerOutput = ExtractFunctionOutput<
      typeof testContract,
      "get-owner"
    >;
    expectTypeOf<GetOwnerOutput>().toEqualTypeOf<string | null>();
  });

  it("should generate contract interface", () => {
    type Interface = ContractInterface<typeof testContract>;

    // Test the type structure without runtime calls
    expectTypeOf<Interface>().toHaveProperty("transfer");
    expectTypeOf<Interface>().toHaveProperty("mint");

    // Test that transfer accepts both object and positional args
    type TransferFn = Interface["transfer"];
    expectTypeOf<TransferFn>().toBeCallableWith({
      id: 1n,
      sender: "SP...",
      recipient: "SP...",
    });
    expectTypeOf<TransferFn>().toBeCallableWith(1n, "SP...", "SP...");

    // Test that mint accepts the right arguments
    type MintFn = Interface["mint"];
    expectTypeOf<MintFn>().toBeCallableWith({
      recipient: "SP...",
      metadata: { uri: "https://...", name: "Test" },
    });
    expectTypeOf<MintFn>().toBeCallableWith("SP...", {
      uri: "https://...",
      name: "Test",
    });

    // Test return type
    expectTypeOf<ReturnType<TransferFn>>().toEqualTypeOf<ContractCallParams>();
  });
});

describe("Complex Type Inference", () => {
  it("should handle nested complex types", () => {
    // List of tuples
    type ComplexType1 = ClarityToTS<{
      list: {
        type: {
          tuple: [
            { name: "id"; type: "uint128" },
            {
              name: "data";
              type: { optional: { "string-utf8": { length: 50 } } };
            }
          ];
        };
        length: 100;
      };
    }>;

    expectTypeOf<ComplexType1>().toEqualTypeOf<
      Array<{
        id: bigint;
        data: string | null;
      }>
    >();

    // Response with tuple
    type ComplexType2 = ClarityToTS<{
      response: {
        ok: {
          tuple: [
            { name: "status"; type: "bool" },
            { name: "count"; type: "uint128" }
          ];
        };
        error: { "string-ascii": { length: 100 } };
      };
    }>;

    expectTypeOf<ComplexType2>().toEqualTypeOf<
      { ok: { status: boolean; count: bigint } } | { err: string }
    >();
  });
});
