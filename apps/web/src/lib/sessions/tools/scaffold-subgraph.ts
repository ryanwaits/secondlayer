import { highlight } from "@/lib/highlight";
import { generateSubgraphCode } from "@/lib/scaffold/generate";
import { tool } from "ai";
import { z } from "zod";

export function createScaffoldSubgraph() {
	return tool({
		description:
			"Generate a subgraph scaffold from a Stacks contract. Fetches the contract ABI and generates a complete defineSubgraph() TypeScript file. Use when the user asks to scaffold, generate, or create a subgraph for a contract.",
		inputSchema: z.object({
			contractId: z
				.string()
				.describe(
					"Full contract identifier, e.g. SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
				),
		}),
		execute: async ({ contractId }) => {
			const [addr, name] = contractId.split(".");
			if (!addr || !name) {
				return {
					error: true,
					message:
						"Invalid contract ID format. Expected: SP...address.contract-name",
				};
			}

			const res = await fetch(
				`https://api.hiro.so/v2/contracts/interface/${addr}/${name}`,
			);
			if (!res.ok) {
				return {
					error: true,
					message: `Failed to fetch contract ABI (HTTP ${res.status})`,
				};
			}

			const abi = await res.json();
			const publicFunctions = (abi.functions ?? []).filter(
				(f: Record<string, unknown>) => f.access === "public",
			);

			if (publicFunctions.length === 0) {
				return {
					error: true,
					message: `Contract ${contractId} has no public functions to scaffold`,
				};
			}

			const code = generateSubgraphCode(contractId, publicFunctions);
			const html = await highlight(code, "typescript");
			return {
				code,
				html,
				contractId,
				filename: `subgraphs/${name}.ts`,
				functionCount: publicFunctions.length,
			};
		},
	});
}
