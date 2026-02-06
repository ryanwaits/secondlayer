import { describe, it } from "bun:test";
import { expectTypeOf } from "expect-type";
import type {
  AbiToTS,
  AbiContract,
  ExtractFunctionNames,
  ExtractFunctionArgs,
  ExtractFunctionOutput,
  ExtractMapNames,
  ExtractMapKey,
  ExtractMapValue,
  ExtractVariableNames,
  ExtractVariableType,
  ExtractConstants,
  ExtractDataVars,
  ExtractFungibleTokenNames,
  ExtractNonFungibleTokenNames,
  ExtractNFTAssetType,
  ExtractDefinedTraitNames,
  ExtractImplementedTraits,
  ExtractPrivateFunctions,
} from "../index.ts";

describe("Type Inference", () => {
  it("should infer primitive types correctly", () => {
    type TestUint = AbiToTS<"uint128">;
    expectTypeOf<TestUint>().toEqualTypeOf<bigint>();

    type TestInt = AbiToTS<"int128">;
    expectTypeOf<TestInt>().toEqualTypeOf<bigint>();

    type TestBool = AbiToTS<"bool">;
    expectTypeOf<TestBool>().toEqualTypeOf<boolean>();

    type TestPrincipal = AbiToTS<"principal">;
    expectTypeOf<TestPrincipal>().toEqualTypeOf<string>();
  });

  it("should infer string types correctly", () => {
    type TestAscii = AbiToTS<{ "string-ascii": { length: 50 } }>;
    expectTypeOf<TestAscii>().toEqualTypeOf<string>();

    type TestUtf8 = AbiToTS<{ "string-utf8": { length: 100 } }>;
    expectTypeOf<TestUtf8>().toEqualTypeOf<string>();
  });

  it("should infer buffer types correctly", () => {
    type TestBuffer = AbiToTS<{ buff: { length: 32 } }>;
    expectTypeOf<TestBuffer>().toEqualTypeOf<Uint8Array>();
  });

  it("should infer optional types correctly", () => {
    type TestOptional = AbiToTS<{ optional: "uint128" }>;
    expectTypeOf<TestOptional>().toEqualTypeOf<bigint | null>();
  });

  it("should infer response types correctly", () => {
    type TestResponse = AbiToTS<{
      response: { ok: "bool"; error: "uint128" };
    }>;
    expectTypeOf<TestResponse>().toEqualTypeOf<{ ok: boolean } | { err: bigint }>();
  });

  it("should infer list types correctly", () => {
    type TestList = AbiToTS<{ list: { type: "uint128"; length: 10 } }>;
    expectTypeOf<TestList>().toEqualTypeOf<bigint[]>();
  });

  it("should infer tuple types correctly", () => {
    type TestTuple = AbiToTS<{
      tuple: [
        { name: "id"; type: "uint128" },
        { name: "owner"; type: "principal" },
        { name: "active"; type: "bool" },
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
        outputs: { response: { ok: "bool", error: "uint128" } },
      },
      {
        name: "get-owner",
        access: "read-only",
        args: [{ name: "id", type: "uint128" }],
        outputs: { optional: "principal" },
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
        outputs: { response: { ok: "uint128", error: "uint128" } },
      },
    ],
  } as const satisfies AbiContract;

  it("should extract function names", () => {
    type FunctionNames = ExtractFunctionNames<typeof testContract>;
    expectTypeOf<FunctionNames>().toEqualTypeOf<"transfer" | "get-owner" | "mint">();
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
      metadata: { uri: string; name: string };
    }>();
  });

  it("should extract function outputs", () => {
    type TransferOutput = ExtractFunctionOutput<typeof testContract, "transfer">;
    expectTypeOf<TransferOutput>().toEqualTypeOf<{ ok: boolean } | { err: bigint }>();

    type GetOwnerOutput = ExtractFunctionOutput<typeof testContract, "get-owner">;
    expectTypeOf<GetOwnerOutput>().toEqualTypeOf<string | null>();
  });
});

describe("Complex Type Inference", () => {
  it("should handle nested complex types", () => {
    type ComplexType1 = AbiToTS<{
      list: {
        type: {
          tuple: [
            { name: "id"; type: "uint128" },
            { name: "data"; type: { optional: { "string-utf8": { length: 50 } } } },
          ];
        };
        length: 100;
      };
    }>;
    expectTypeOf<ComplexType1>().toEqualTypeOf<
      Array<{ id: bigint; data: string | null }>
    >();

    type ComplexType2 = AbiToTS<{
      response: {
        ok: {
          tuple: [
            { name: "status"; type: "bool" },
            { name: "count"; type: "uint128" },
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

describe("Map and Variable Extraction", () => {
  const contractWithMapsAndVars = {
    functions: [
      {
        name: "internal-helper",
        access: "private",
        args: [],
        outputs: "bool",
      },
    ],
    maps: [
      { name: "balances", key: "principal", value: "uint128" },
      { name: "token-owners", key: "uint128", value: { optional: "principal" } },
    ],
    variables: [
      { name: "contract-owner", type: "principal", access: "constant" },
      { name: "total-supply", type: "uint128", access: "variable" },
    ],
    fungible_tokens: [{ name: "my-token" }],
    non_fungible_tokens: [{ name: "my-nft", type: "uint128" }],
    implemented_traits: [
      "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.sip-010-trait",
    ],
    defined_traits: [
      {
        name: "transfer-trait",
        functions: [
          {
            name: "transfer",
            access: "public",
            args: [{ name: "amount", type: "uint128" }],
            outputs: { response: { ok: "bool", error: "uint128" } },
          },
        ],
      },
    ],
  } as const satisfies AbiContract;

  it("should extract map names", () => {
    type MapNames = ExtractMapNames<typeof contractWithMapsAndVars>;
    expectTypeOf<MapNames>().toEqualTypeOf<"balances" | "token-owners">();
  });

  it("should extract map key and value types", () => {
    type BalanceKey = ExtractMapKey<typeof contractWithMapsAndVars, "balances">;
    type BalanceValue = ExtractMapValue<typeof contractWithMapsAndVars, "balances">;
    expectTypeOf<BalanceKey>().toEqualTypeOf<string>();
    expectTypeOf<BalanceValue>().toEqualTypeOf<bigint>();
  });

  it("should extract variable names by access", () => {
    type AllVars = ExtractVariableNames<typeof contractWithMapsAndVars>;
    type Constants = ExtractConstants<typeof contractWithMapsAndVars>;
    type DataVars = ExtractDataVars<typeof contractWithMapsAndVars>;
    expectTypeOf<AllVars>().toEqualTypeOf<"contract-owner" | "total-supply">();
    expectTypeOf<Constants>().toEqualTypeOf<"contract-owner">();
    expectTypeOf<DataVars>().toEqualTypeOf<"total-supply">();
  });

  it("should extract variable types", () => {
    type SupplyType = ExtractVariableType<typeof contractWithMapsAndVars, "total-supply">;
    expectTypeOf<SupplyType>().toEqualTypeOf<bigint>();
  });

  it("should extract token names", () => {
    type FTNames = ExtractFungibleTokenNames<typeof contractWithMapsAndVars>;
    type NFTNames = ExtractNonFungibleTokenNames<typeof contractWithMapsAndVars>;
    expectTypeOf<FTNames>().toEqualTypeOf<"my-token">();
    expectTypeOf<NFTNames>().toEqualTypeOf<"my-nft">();
  });

  it("should extract NFT asset type", () => {
    type NFTAsset = ExtractNFTAssetType<typeof contractWithMapsAndVars, "my-nft">;
    expectTypeOf<NFTAsset>().toEqualTypeOf<bigint>();
  });

  it("should extract trait names", () => {
    type DefinedTraits = ExtractDefinedTraitNames<typeof contractWithMapsAndVars>;
    type ImplementedTraits = ExtractImplementedTraits<typeof contractWithMapsAndVars>;
    expectTypeOf<DefinedTraits>().toEqualTypeOf<"transfer-trait">();
    expectTypeOf<ImplementedTraits>().toEqualTypeOf<"SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.sip-010-trait">();
  });

  it("should extract private functions", () => {
    type PrivateFns = ExtractPrivateFunctions<typeof contractWithMapsAndVars>;
    expectTypeOf<PrivateFns>().toEqualTypeOf<"internal-helper">();
  });
});
