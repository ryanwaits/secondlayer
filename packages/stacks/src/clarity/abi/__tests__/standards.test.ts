import { describe, expect, test } from "bun:test";
import {
  SIP010_ABI,
  SIP009_ABI,
  SIP013_ABI,
  sip010Abi,
  sip009Abi,
  sip013Abi,
} from "../standards.ts";
import type { AbiContract } from "../contract.ts";
import type {
  ExtractFunctionNames,
  ExtractPublicFunctions,
  ExtractReadOnlyFunctions,
} from "../extractors.ts";

describe("Standard ABIs", () => {
  describe("SIP-010 Fungible Token", () => {
    test("has correct structure", () => {
      expect(SIP010_ABI.functions).toHaveLength(7);
      expect(SIP010_ABI.fungible_tokens).toHaveLength(1);
    });

    test("has all required functions", () => {
      const names = SIP010_ABI.functions.map((f) => f.name);
      expect(names).toContain("transfer");
      expect(names).toContain("get-balance");
      expect(names).toContain("get-total-supply");
      expect(names).toContain("get-name");
      expect(names).toContain("get-symbol");
      expect(names).toContain("get-decimals");
      expect(names).toContain("get-token-uri");
    });

    test("transfer function has correct signature", () => {
      const transfer = SIP010_ABI.functions.find((f) => f.name === "transfer");
      expect(transfer).toBeDefined();
      expect(transfer?.access).toBe("public");
      expect(transfer?.args).toHaveLength(4);
      expect(transfer?.args[0].name).toBe("amount");
      expect(transfer?.args[0].type).toBe("uint128");
      expect(transfer?.args[1].name).toBe("sender");
      expect(transfer?.args[1].type).toBe("principal");
      expect(transfer?.args[2].name).toBe("recipient");
      expect(transfer?.args[2].type).toBe("principal");
      expect(transfer?.args[3].name).toBe("memo");
      expect(transfer?.outputs).toEqual({ response: { ok: "bool", error: "uint128" } });
    });

    test("get-balance function has correct signature", () => {
      const getBalance = SIP010_ABI.functions.find((f) => f.name === "get-balance");
      expect(getBalance).toBeDefined();
      expect(getBalance?.access).toBe("read-only");
      expect(getBalance?.args).toHaveLength(1);
      expect(getBalance?.args[0].name).toBe("account");
      expect(getBalance?.args[0].type).toBe("principal");
      expect(getBalance?.outputs).toEqual({ response: { ok: "uint128", error: "uint128" } });
    });

    test("type inference works", () => {
      type Functions = ExtractFunctionNames<typeof SIP010_ABI>;
      type PublicFns = ExtractPublicFunctions<typeof SIP010_ABI>;
      type ReadOnlyFns = ExtractReadOnlyFunctions<typeof SIP010_ABI>;

      const _typeCheck: Functions = "transfer";
      const _typeCheck2: PublicFns = "transfer";
      const _typeCheck3: ReadOnlyFns = "get-balance";

      expect(true).toBe(true); // type check passes
    });

    test("camelCase alias works", () => {
      expect(sip010Abi).toBe(SIP010_ABI);
    });
  });

  describe("SIP-009 NFT", () => {
    test("has correct structure", () => {
      expect(SIP009_ABI.functions).toHaveLength(4);
      expect(SIP009_ABI.non_fungible_tokens).toHaveLength(1);
    });

    test("has all required functions", () => {
      const names = SIP009_ABI.functions.map((f) => f.name);
      expect(names).toContain("transfer");
      expect(names).toContain("get-owner");
      expect(names).toContain("get-last-token-id");
      expect(names).toContain("get-token-uri");
    });

    test("transfer function has correct signature", () => {
      const transfer = SIP009_ABI.functions.find((f) => f.name === "transfer");
      expect(transfer).toBeDefined();
      expect(transfer?.access).toBe("public");
      expect(transfer?.args).toHaveLength(3);
      expect(transfer?.args[0].name).toBe("id");
      expect(transfer?.args[0].type).toBe("uint128");
      expect(transfer?.args[1].name).toBe("sender");
      expect(transfer?.args[1].type).toBe("principal");
      expect(transfer?.args[2].name).toBe("recipient");
      expect(transfer?.args[2].type).toBe("principal");
      expect(transfer?.outputs).toEqual({ response: { ok: "bool", error: "uint128" } });
    });

    test("get-owner function has correct signature", () => {
      const getOwner = SIP009_ABI.functions.find((f) => f.name === "get-owner");
      expect(getOwner).toBeDefined();
      expect(getOwner?.access).toBe("read-only");
      expect(getOwner?.args).toHaveLength(1);
      expect(getOwner?.args[0].name).toBe("id");
      expect(getOwner?.args[0].type).toBe("uint128");
      expect(getOwner?.outputs).toEqual({
        response: { ok: { optional: "principal" }, error: "uint128" },
      });
    });

    test("camelCase alias works", () => {
      expect(sip009Abi).toBe(SIP009_ABI);
    });
  });

  describe("SIP-013 Semi-Fungible Token", () => {
    test("has correct structure", () => {
      expect(SIP013_ABI.functions).toHaveLength(10);
      expect(SIP013_ABI.fungible_tokens).toEqual([]);
      expect(SIP013_ABI.non_fungible_tokens).toEqual([]);
    });

    test("has all required functions", () => {
      const names = SIP013_ABI.functions.map((f) => f.name);
      expect(names).toContain("transfer");
      expect(names).toContain("transfer-memo");
      expect(names).toContain("transfer-many");
      expect(names).toContain("transfer-many-memo");
      expect(names).toContain("get-balance");
      expect(names).toContain("get-overall-balance");
      expect(names).toContain("get-total-supply");
      expect(names).toContain("get-overall-supply");
      expect(names).toContain("get-decimals");
      expect(names).toContain("get-token-uri");
    });

    test("transfer function has correct signature", () => {
      const transfer = SIP013_ABI.functions.find((f) => f.name === "transfer");
      expect(transfer).toBeDefined();
      expect(transfer?.access).toBe("public");
      expect(transfer?.args).toHaveLength(4);
      expect(transfer?.args[0].name).toBe("token-id");
      expect(transfer?.args[0].type).toBe("uint128");
      expect(transfer?.args[1].name).toBe("amount");
      expect(transfer?.args[1].type).toBe("uint128");
      expect(transfer?.args[2].name).toBe("sender");
      expect(transfer?.args[2].type).toBe("principal");
      expect(transfer?.args[3].name).toBe("recipient");
      expect(transfer?.args[3].type).toBe("principal");
      expect(transfer?.outputs).toEqual({ response: { ok: "bool", error: "uint128" } });
    });

    test("transfer-many function has correct signature", () => {
      const transferMany = SIP013_ABI.functions.find((f) => f.name === "transfer-many");
      expect(transferMany).toBeDefined();
      expect(transferMany?.access).toBe("public");
      expect(transferMany?.args).toHaveLength(1);
      expect(transferMany?.args[0].name).toBe("transfers");
      const argType = transferMany?.args[0].type;
      expect(argType).toHaveProperty("list");
      if (typeof argType === "object" && "list" in argType) {
        expect(argType.list.length).toBe(200);
        expect(argType.list.type).toHaveProperty("tuple");
      }
    });

    test("get-balance function has correct signature", () => {
      const getBalance = SIP013_ABI.functions.find((f) => f.name === "get-balance");
      expect(getBalance).toBeDefined();
      expect(getBalance?.access).toBe("read-only");
      expect(getBalance?.args).toHaveLength(2);
      expect(getBalance?.args[0].name).toBe("token-id");
      expect(getBalance?.args[0].type).toBe("uint128");
      expect(getBalance?.args[1].name).toBe("account");
      expect(getBalance?.args[1].type).toBe("principal");
      expect(getBalance?.outputs).toEqual({ response: { ok: "uint128", error: "uint128" } });
    });

    test("camelCase alias works", () => {
      expect(sip013Abi).toBe(SIP013_ABI);
    });
  });

  describe("Type compatibility", () => {
    test("all ABIs satisfy AbiContract", () => {
      const _abi1: AbiContract = SIP010_ABI;
      const _abi2: AbiContract = SIP009_ABI;
      const _abi3: AbiContract = SIP013_ABI;
      expect(true).toBe(true); // type check passes
    });
  });
});
