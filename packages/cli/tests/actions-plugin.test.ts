import { describe, it, expect, beforeEach } from "bun:test";
import { generateActionHelpers } from "../src/plugins/actions/generators";
import type { ProcessedContract } from "../src/types/plugin";
import type { ActionsPluginOptions } from "../src/plugins/actions/index";

describe("Actions Plugin", () => {
  const sampleContract: ProcessedContract = {
    name: "testContract",
    address: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9",
    contractName: "test-contract",
    abi: {
      functions: [
        {
          name: "transfer",
          access: "public",
          args: [
            { name: "amount", type: "uint128" },
            { name: "sender", type: "principal" },
            { name: "recipient", type: "principal" },
          ],
          outputs: { response: { ok: "bool", error: "uint128" } },
        },
        {
          name: "get-balance",
          access: "read-only",
          args: [{ name: "account", type: "principal" }],
          outputs: "uint128",
        },
        {
          name: "get-total-supply",
          access: "read-only",
          args: [],
          outputs: "uint128",
        },
        {
          name: "mint",
          access: "public",
          args: [{ name: "amount", type: "uint128" }],
          outputs: { response: { ok: "bool", error: "uint128" } },
        },
      ],
    },
    source: "local",
    metadata: { source: "clarinet" },
  };

  describe("Read Helper Generation", () => {
    it("should generate read helpers for read-only functions", async () => {
      const options: ActionsPluginOptions = {};
      const code = await generateActionHelpers(sampleContract, options);

      // Should contain read helper functions
      expect(code).toContain("read: {");
      expect(code).toContain("async getBalance(");
      expect(code).toContain("async getTotalSupply(");

      // Should use fetchCallReadOnlyFunction
      expect(code).toContain("fetchCallReadOnlyFunction");

      // Should handle arguments correctly
      expect(code).toContain("args: { account: string }");

      // Should handle no-argument functions
      expect(code).toContain("async getTotalSupply(options?:");
    });

    it("should filter read functions based on includeFunctions option", async () => {
      const options: ActionsPluginOptions = {
        includeFunctions: ["get-balance"],
      };
      const code = await generateActionHelpers(sampleContract, options);

      expect(code).toContain("async getBalance(");
      expect(code).not.toContain("async getTotalSupply(");
    });

    it("should filter read functions based on excludeFunctions option", async () => {
      const options: ActionsPluginOptions = {
        excludeFunctions: ["get-balance"],
      };
      const code = await generateActionHelpers(sampleContract, options);

      expect(code).not.toContain("async getBalance(");
      expect(code).toContain("async getTotalSupply(");
    });
  });

  describe("Write Helper Generation", () => {
    it("should generate write helpers for public functions", async () => {
      const options: ActionsPluginOptions = {};
      const code = await generateActionHelpers(sampleContract, options);

      // Should contain write helper functions
      expect(code).toContain("write: {");
      expect(code).toContain("async transfer(");
      expect(code).toContain("async mint(");

      // Should use makeContractCall
      expect(code).toContain("makeContractCall");

      // Should have optional senderKey parameter
      expect(code).toContain("senderKey?: string");

      // Should have env var fallback
      expect(code).toContain("process.env.STX_SENDER_KEY");
      expect(code).toContain("senderKey required: pass as argument or set STX_SENDER_KEY env var");

      // Should handle arguments correctly
      expect(code).toContain(
        "args: { amount: bigint; sender: string; recipient: string }"
      );
    });

    it("should filter write functions based on includeFunctions option", async () => {
      const options: ActionsPluginOptions = {
        includeFunctions: ["transfer"],
      };
      const code = await generateActionHelpers(sampleContract, options);

      expect(code).toContain("async transfer(");
      expect(code).not.toContain("async mint(");
    });

    it("should filter write functions based on excludeFunctions option", async () => {
      const options: ActionsPluginOptions = {
        excludeFunctions: ["transfer"],
      };
      const code = await generateActionHelpers(sampleContract, options);

      expect(code).not.toContain("async transfer(");
      expect(code).toContain("async mint(");
    });

    it("should use custom senderKeyEnv when provided", async () => {
      const options: ActionsPluginOptions = {
        senderKeyEnv: "MY_CUSTOM_KEY",
      };
      const code = await generateActionHelpers(sampleContract, options);

      expect(code).toContain("process.env.MY_CUSTOM_KEY");
      expect(code).toContain("senderKey required: pass as argument or set MY_CUSTOM_KEY env var");
      expect(code).not.toContain("STX_SENDER_KEY");
    });
  });

  describe("Edge Cases", () => {
    it("should handle contracts with only read-only functions", async () => {
      const readOnlyContract: ProcessedContract = {
        name: "readOnlyContract",
        address: "SP123",
        contractName: "read-only",
        abi: {
          functions: [
            {
              name: "get-data",
              access: "read-only",
              args: [{ name: "id", type: "uint128" }],
              outputs: "uint128",
            },
          ],
        },
        source: "local",
        metadata: { source: "clarinet" },
      };

      const code = await generateActionHelpers(readOnlyContract, {});

      expect(code).toContain("read: {");
      expect(code).not.toContain("write: {");
    });

    it("should handle contracts with only public functions", async () => {
      const writeOnlyContract: ProcessedContract = {
        name: "writeOnlyContract",
        address: "SP123",
        contractName: "write-only",
        abi: {
          functions: [
            {
              name: "set-data",
              access: "public",
              args: [{ name: "value", type: "uint128" }],
              outputs: { response: { ok: "bool", error: "uint128" } },
            },
          ],
        },
        source: "local",
        metadata: { source: "clarinet" },
      };

      const code = await generateActionHelpers(writeOnlyContract, {});

      expect(code).toContain("write: {");
      expect(code).not.toContain("read: {");
    });

    it("should return empty string for contracts with no public or read-only functions", async () => {
      const emptyContract: ProcessedContract = {
        name: "emptyContract",
        address: "SP123",
        contractName: "empty",
        abi: {
          functions: [
            {
              name: "internal-function",
              access: "private",
              args: [],
              outputs: "bool",
            },
          ],
        },
        source: "local",
        metadata: { source: "clarinet" },
      };

      const code = await generateActionHelpers(emptyContract, {});

      expect(code).toBe("");
    });
  });
});
