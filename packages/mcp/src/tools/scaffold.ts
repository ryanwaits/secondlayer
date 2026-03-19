import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateSubgraphCode } from "../lib/scaffold-generate.ts";
import { defineTool } from "../lib/tool.ts";

const API_BASE = process.env.SECONDLAYER_API_URL || "https://api.secondlayer.tools";

async function fetchAbi(contractId: string): Promise<{ functions: any[]; maps: any[] }> {
  const res = await fetch(`${API_BASE}/api/node/contracts/${contractId}/abi`);
  if (!res.ok) {
    if (res.status === 404) throw new Error(`Contract not found: ${contractId}`);
    throw new Error(`Failed to fetch ABI: HTTP ${res.status}`);
  }
  const abi = await res.json() as Record<string, any>;
  return {
    functions: abi.functions ?? [],
    maps: abi.maps ?? [],
  };
}

export function registerScaffoldTools(server: McpServer) {
  defineTool<{ contractId: string; subgraphName?: string }>(
    server,
    "scaffold_from_contract",
    "Generate a subgraph scaffold from a deployed Stacks contract. Fetches the ABI automatically.",
    {
      contractId: z.string().describe("Fully qualified contract ID (e.g. SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01)"),
      subgraphName: z.string().optional().describe("Override the subgraph name (defaults to contract name)"),
    },
    async ({ contractId, subgraphName }) => {
      const { functions, maps } = await fetchAbi(contractId);
      const code = generateSubgraphCode(contractId, functions, subgraphName, maps);
      return { content: [{ type: "text", text: code }] };
    },
  );

  defineTool<{ abi: string; contractId: string; subgraphName?: string }>(
    server,
    "scaffold_from_abi",
    "Generate a subgraph scaffold from a provided ABI JSON. Use when you already have the ABI.",
    {
      abi: z.string().describe("ABI JSON string (the full contract ABI object)"),
      contractId: z.string().describe("Fully qualified contract ID"),
      subgraphName: z.string().optional().describe("Override the subgraph name"),
    },
    async ({ abi, contractId, subgraphName }) => {
      let parsed: Record<string, any>;
      try {
        parsed = JSON.parse(abi);
      } catch {
        return { content: [{ type: "text", text: "Invalid ABI JSON" }], isError: true };
      }
      const code = generateSubgraphCode(
        contractId,
        parsed.functions ?? [],
        subgraphName,
        parsed.maps ?? [],
      );
      return { content: [{ type: "text", text: code }] };
    },
  );
}
