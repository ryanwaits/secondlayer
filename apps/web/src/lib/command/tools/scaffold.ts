import { tool } from "ai";
import { z } from "zod";
import { generateSubgraphCode } from "@/lib/scaffold/generate";

export const scaffold = tool({
  description:
    "Generate a subgraph scaffold from a Stacks contract. Fetches the contract ABI from the Stacks API and generates a complete defineSubgraph() TypeScript file. Use when the user asks to scaffold, generate, or create a subgraph for a contract.",
  inputSchema: z.object({
    contractId: z
      .string()
      .describe("Full contract identifier, e.g. SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01"),
  }),
  execute: async ({ contractId }) => {
    try {
      const [addr, name] = contractId.split(".");
      if (!addr || !name) {
        return { error: true, message: "Invalid contract ID format. Expected: SP...address.contract-name" };
      }

      // Fetch ABI from public Stacks API
      const res = await fetch(
        `https://api.hiro.so/v2/contracts/interface/${addr}/${name}`,
      );

      if (!res.ok) {
        return { error: true, message: `Failed to fetch contract ABI (HTTP ${res.status})` };
      }

      const abi = await res.json();
      const publicFunctions = (abi.functions ?? []).filter(
        (f: any) => f.access === "public",
      );

      if (publicFunctions.length === 0) {
        return { error: true, message: `Contract ${contractId} has no public functions to scaffold` };
      }

      const code = generateSubgraphCode(contractId, publicFunctions);
      return { code, contractId, functionCount: publicFunctions.length };
    } catch (err) {
      return { error: true, message: `Error fetching ABI: ${err instanceof Error ? err.message : "Unknown error"}` };
    }
  },
});
