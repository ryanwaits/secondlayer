import { describe, it, expect } from "vitest";
import { generateContractInterface } from "../src/generators/contract";
import type { ResolvedContract } from "../src/types/config";

describe("Buffer Conversion Enhancement", () => {
  const contractWithBuffer: ResolvedContract = {
    name: "mega",
    address: "SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27",
    contractName: "miamicoin-core-v1",
    abi: {
      functions: [
        {
          name: "callback",
          access: "public",
          args: [
            { name: "sender", type: "principal" },
            { name: "memo", type: { buff: 34 } },
          ],
          outputs: {
            response: {
              ok: "bool",
              error: "uint128",
            },
          },
        },
        {
          name: "store-data",
          access: "public",
          args: [
            { name: "key", type: { "string-ascii": 32 } },
            { name: "data", type: { buff: 1024 } },
          ],
          outputs: {
            response: {
              ok: "bool",
              error: "uint128",
            },
          },
        },
      ],
    },
    source: "api",
  };

  it("should generate flexible buffer conversion code", async () => {
    const code = await generateContractInterface([contractWithBuffer]);

    // Should generate runtime conversion logic
    expect(code).toContain("value instanceof Uint8Array");
    expect(code).toContain("Cl.bufferFromAscii");
    expect(code).toContain("Cl.bufferFromUtf8");
    expect(code).toContain("Cl.bufferFromHex");
    expect(code).toContain("value.startsWith('0x')");
  });

  it("should handle different buffer input formats in generated code", async () => {
    const code = await generateContractInterface([contractWithBuffer]);

    // Verify the code contains the logic for all supported formats
    expect(code).toContain("case 'ascii':");
    expect(code).toContain("case 'utf8':");
    expect(code).toContain("case 'hex':");
    expect(code).toContain("throw new Error(`Invalid buffer value");
  });

  it("should generate contract interface that accepts the flexible buffer types", async () => {
    const code = await generateContractInterface([contractWithBuffer]);

    // The generated interface should allow these patterns:
    // 1. mega.callback({ sender: "SP...", memo: "Hello" })
    // 2. mega.callback({ sender: "SP...", memo: new Uint8Array([72, 101, 108, 108, 111]) })
    // 3. mega.callback({ sender: "SP...", memo: { type: 'ascii', value: 'Hello' } })
    // 4. mega.callback("SP...", "Hello")

    expect(code).toContain("callback(");
    expect(code).toContain("storeData(");
  });
});
