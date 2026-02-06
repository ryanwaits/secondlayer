import { describe, it, expect, mock } from "bun:test";
import { expectTypeOf } from "expect-type";
import { getContract, ContractResponseError } from "../getContract.ts";
import { Cl } from "../../clarity/values.ts";
import type { AbiContract } from "../../clarity/abi/contract.ts";
import type { Client } from "../../clients/types.ts";
import type { ExtractFunctionArgs, ExtractFunctionOutput, AbiToTS } from "../../clarity/abi/index.ts";

const TEST_ABI = {
  functions: [
    {
      name: "get-balance",
      access: "read-only",
      args: [{ name: "account", type: "principal" }],
      outputs: { response: { ok: "uint128", error: "uint128" } },
    },
    {
      name: "get-name",
      access: "read-only",
      args: [],
      outputs: { response: { ok: { "string-ascii": { length: 32 } }, error: "uint128" } },
    },
    {
      name: "transfer",
      access: "public",
      args: [
        { name: "amount", type: "uint128" },
        { name: "sender", type: "principal" },
        { name: "recipient", type: "principal" },
        { name: "memo", type: { optional: { buff: { length: 34 } } } },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
  ],
  maps: [
    { name: "token-balances", key: "principal", value: "uint128" },
  ],
} as const satisfies AbiContract;

function createMockClient(
  requestHandler: (path: string, init?: any) => Promise<any>,
): Client {
  return {
    transport: { request: async () => ({}) },
    request: requestHandler,
    extend: () => ({}) as any,
  };
}

describe("getContract", () => {
  describe("type inference", () => {
    it("should infer read method argument types", () => {
      type GetBalanceArgs = ExtractFunctionArgs<typeof TEST_ABI, "get-balance">;
      expectTypeOf<GetBalanceArgs>().toEqualTypeOf<{ account: string }>();
    });

    it("should infer read method output types (response unwrapped)", () => {
      type GetBalanceOutput = ExtractFunctionOutput<typeof TEST_ABI, "get-balance">;
      expectTypeOf<GetBalanceOutput>().toEqualTypeOf<{ ok: bigint } | { err: bigint }>();
    });

    it("should infer transfer args", () => {
      type TransferArgs = ExtractFunctionArgs<typeof TEST_ABI, "transfer">;
      expectTypeOf<TransferArgs>().toEqualTypeOf<{
        amount: bigint;
        sender: string;
        recipient: string;
        memo: Uint8Array | null;
      }>();
    });
  });

  describe("read methods", () => {
    it("should call readContract and auto-unwrap ok response", async () => {
      const mockClient = createMockClient(async (path, init) => {
        // readContract POST returns { okay: true, result: hex }
        return {
          okay: true,
          result: Cl.serialize(Cl.ok(Cl.uint(1000n))),
        };
      });

      const contract = getContract({
        client: mockClient,
        address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        name: "my-token",
        abi: TEST_ABI,
      });

      const balance = await contract.read.getBalance({
        account: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      });

      expect(balance).toBe(1000n);
    });

    it("should throw ContractResponseError on err response", async () => {
      const mockClient = createMockClient(async () => ({
        okay: true,
        result: Cl.serialize(Cl.error(Cl.uint(1n))),
      }));

      const contract = getContract({
        client: mockClient,
        address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        name: "my-token",
        abi: TEST_ABI,
      });

      expect(
        contract.read.getBalance({
          account: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        }),
      ).rejects.toThrow(ContractResponseError);
    });

    it("should handle no-arg read-only functions", async () => {
      const mockClient = createMockClient(async () => ({
        okay: true,
        result: Cl.serialize(Cl.ok(Cl.stringAscii("TestToken"))),
      }));

      const contract = getContract({
        client: mockClient,
        address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        name: "my-token",
        abi: TEST_ABI,
      });

      const name = await contract.read.getName({});
      expect(name).toBe("TestToken");
    });
  });

  describe("map methods", () => {
    it("should return value for existing map entry", async () => {
      const mockClient = createMockClient(async () => ({
        data: Cl.serialize(Cl.some(Cl.uint(500n))),
      }));

      const contract = getContract({
        client: mockClient,
        address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        name: "my-token",
        abi: TEST_ABI,
      });

      const balance = await contract.maps.tokenBalances(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      );
      expect(balance).toBe(500n);
    });

    it("should return null for missing map entry", async () => {
      const mockClient = createMockClient(async () => ({
        data: Cl.serialize(Cl.none()),
      }));

      const contract = getContract({
        client: mockClient,
        address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
        name: "my-token",
        abi: TEST_ABI,
      });

      const balance = await contract.maps.tokenBalances(
        "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
      );
      expect(balance).toBeNull();
    });
  });
});
