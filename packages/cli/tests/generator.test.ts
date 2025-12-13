import { describe, it, expect } from "vitest";
import { generateContractInterface } from "../src/generators/contract";
import type { ResolvedContract } from "../src/types/config";

describe("Contract Generator", () => {
  const sampleContract: ResolvedContract = {
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
          name: "get-info",
          access: "read-only",
          args: [],
          outputs: {
            tuple: [
              { name: "total-supply", type: "uint128" },
              { name: "name", type: { "string-ascii": 32 } },
            ],
          },
        },
        {
          name: "internal-function",
          access: "private",
          args: [],
          outputs: "bool",
        },
      ],
    },
    source: "api",
  };

  describe("Basic Contract Generation", () => {
    it("should generate a contract interface with type-safe methods", async () => {
      const code = await generateContractInterface([sampleContract]);

      // Check imports
      expect(code).toContain(
        "import { Cl, validateStacksAddress } from '@stacks/transactions'"
      );

      // Check contract generation
      expect(code).toContain("export const testContract");
      expect(code).toContain(
        "address: 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9'"
      );
      expect(code).toContain("contractName: 'test-contract'");

      // Check method generation
      expect(code).toContain("transfer(");
      expect(code).toContain("getBalance(");
      expect(code).toContain("getInfo()");

      // Should not include private functions
      expect(code).not.toContain("internalFunction");

      // Should generate ABI constant
      expect(code).toContain("export const testContractAbi");
    });

    it("should handle contracts with no arguments", async () => {
      const noArgsContract: ResolvedContract = {
        name: "simpleContract",
        address: "SP123",
        contractName: "simple",
        abi: {
          functions: [
            {
              name: "get-total",
              access: "read-only",
              args: [],
              outputs: "uint128",
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([noArgsContract]);

      expect(code).toContain("getTotal() {");
      expect(code).toContain("functionArgs: []");
    });

    it("should handle single argument functions with flexible syntax", async () => {
      const singleArgContract: ResolvedContract = {
        name: "singleArgContract",
        address: "SP123",
        contractName: "single-arg",
        abi: {
          functions: [
            {
              name: "get-user-balance",
              access: "read-only",
              args: [{ name: "user", type: "principal" }],
              outputs: "uint128",
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([singleArgContract]);

      // Should support both object and direct argument syntax
      expect(code).toContain("getUserBalance(...args:");
      expect(code).toContain("[{ user: string }] | [string]");
    });

    it("should handle multiple contracts", async () => {
      const contract2: ResolvedContract = {
        name: "secondContract",
        address: "SP456",
        contractName: "second-contract",
        abi: {
          functions: [
            {
              name: "mint",
              access: "public",
              args: [{ name: "amount", type: "uint128" }],
              outputs: { response: { ok: "bool", error: "uint128" } },
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([sampleContract, contract2]);

      expect(code).toContain("export const testContract");
      expect(code).toContain("export const secondContract");
      expect(code).toContain("export const testContractAbi");
      expect(code).toContain("export const secondContractAbi");
    });
  });

  describe("Type Conversion", () => {
    it("should generate correct TypeScript types for Clarity types", async () => {
      const typesContract: ResolvedContract = {
        name: "typesContract",
        address: "SP123",
        contractName: "types",
        abi: {
          functions: [
            {
              name: "test-types",
              access: "public",
              args: [
                { name: "uint-val", type: "uint128" },
                { name: "int-val", type: "int128" },
                { name: "bool-val", type: "bool" },
                { name: "principal-val", type: "principal" },
                { name: "ascii-val", type: { "string-ascii": 32 } },
                { name: "utf8-val", type: { "string-utf8": 32 } },
                { name: "buffer-val", type: { buff: 32 } },
              ],
              outputs: "bool",
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([typesContract]);

      expect(code).toContain("uintVal: bigint");
      expect(code).toContain("intVal: bigint");
      expect(code).toContain("boolVal: boolean");
      expect(code).toContain("principalVal: string");
      expect(code).toContain("asciiVal: string");
      expect(code).toContain("utf8Val: string");
      expect(code).toContain(
        "bufferVal: Uint8Array | string | { type: 'ascii' | 'utf8' | 'hex'; value: string }"
      );
    });

    it("should handle optional and list types", async () => {
      const complexTypesContract: ResolvedContract = {
        name: "complexContract",
        address: "SP123",
        contractName: "complex",
        abi: {
          functions: [
            {
              name: "complex-function",
              access: "public",
              args: [
                { name: "optional-val", type: { optional: "uint128" } },
                {
                  name: "list-val",
                  type: { list: { type: "uint128", length: 10 } },
                },
              ],
              outputs: "bool",
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([complexTypesContract]);

      expect(code).toContain("optionalVal: bigint | null");
      expect(code).toContain("listVal: bigint[]");
    });
  });

  describe("Edge Cases", () => {
    it("should handle contracts with only read-only functions", async () => {
      const readOnlyContract: ResolvedContract = {
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
        source: "api",
      };

      const code = await generateContractInterface([readOnlyContract]);

      expect(code).toContain("getData(");
      expect(code).toContain("export const readOnlyContract");
    });

    it("should handle contracts with only public functions", async () => {
      const writeOnlyContract: ResolvedContract = {
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
        source: "api",
      };

      const code = await generateContractInterface([writeOnlyContract]);

      expect(code).toContain("setData(");
      expect(code).toContain("export const writeOnlyContract");
    });

    it("should handle empty contracts", async () => {
      const emptyContract: ResolvedContract = {
        name: "emptyContract",
        address: "SP123",
        contractName: "empty",
        abi: {
          functions: [],
        },
        source: "api",
      };

      const code = await generateContractInterface([emptyContract]);

      expect(code).toContain("export const emptyContract");
      expect(code).toContain("export const emptyContractAbi");
    });

    it("should sanitize function names with hyphens and numbers", async () => {
      const hyphenContract: ResolvedContract = {
        name: "hyphenContract",
        address: "SP123",
        contractName: "hyphen-test",
        abi: {
          functions: [
            {
              name: "test-function-1",
              access: "public",
              args: [],
              outputs: "bool",
            },
            {
              name: "testListOf-10",
              access: "read-only",
              args: [
                {
                  name: "input",
                  type: { list: { type: "uint128", length: 10 } },
                },
              ],
              outputs: "bool",
            },
            {
              name: "get-user-DATA",
              access: "read-only",
              args: [],
              outputs: "uint128",
            },
            {
              name: "test-",
              access: "read-only",
              args: [],
              outputs: "bool",
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([hyphenContract]);

      // Function names should be converted to valid JavaScript identifiers
      expect(code).toContain("testFunction1("); // test-function-1 -> testFunction1
      expect(code).toContain("testListOf10("); // testListOf-10 -> testListOf10
      expect(code).toContain("getUserDATA("); // get-user-DATA -> getUserDATA
      expect(code).toContain("test("); // test- -> test

      // Should not contain any hyphens in method names
      expect(code).not.toMatch(/\w+-\w+\s*\(/); // No hyphenated method names
    });

    it("should sanitize contract names with hyphens to camelCase", async () => {
      const hyphenatedNameContract: ResolvedContract = {
        name: "createRandom", // This should be camelCase
        address: "SP123",
        contractName: "create-random",
        abi: {
          functions: [
            {
              name: "get-random",
              access: "read-only",
              args: [],
              outputs: "uint128",
            },
          ],
        },
        source: "api",
      };

      const getTenureContract: ResolvedContract = {
        name: "getTenureForBlock", // This should be camelCase
        address: "SP456",
        contractName: "get-tenure-for-block",
        abi: {
          functions: [
            {
              name: "get-tenure",
              access: "read-only",
              args: [],
              outputs: "uint128",
            },
          ],
        },
        source: "api",
      };

      const code = await generateContractInterface([
        hyphenatedNameContract,
        getTenureContract,
      ]);

      // Contract exports should use camelCase names
      expect(code).toContain("export const createRandom =");
      expect(code).toContain("export const createRandomAbi =");
      expect(code).toContain("export const getTenureForBlock =");
      expect(code).toContain("export const getTenureForBlockAbi =");

      // Should not contain underscores in export names
      expect(code).not.toContain("create_random");
      expect(code).not.toContain("get_tenure_for_block");
    });
  });
});
