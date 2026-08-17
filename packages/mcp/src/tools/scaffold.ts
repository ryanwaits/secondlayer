import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateSubgraphCode } from "@secondlayer/scaffold";
import type { AbiFunction } from "@secondlayer/scaffold";
import { z } from "zod";
import { getClient } from "../lib/client.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

// Source ABIs from the platform contract registry (prod-safe). The old
// `/api/node/contracts/:id/abi` proxy is OSS/dedicated-only and 404s in prod.
//
// Only `functions` are usable for scaffolding. `abi.maps` is define-map
// STORAGE — map names are not print topics; a source pinned to one matches
// zero events forever. Print sources come from the observed print schema
// (`sl subgraphs create --from-contract`), not the ABI.
async function fetchAbi(
	clientProvider: ClientProvider,
	contractId: string,
): Promise<{ functions: AbiFunction[] }> {
	const contract = await clientProvider().contracts.get(contractId, {
		includeAbi: true,
	});
	if (!contract) throw new Error(`Contract not found: ${contractId}`);
	const abi = contract.abi as {
		functions?: AbiFunction[];
	} | null;
	if (!abi) {
		throw new Error(
			`No ABI available for ${contractId} (abi_status: ${contract.abi_status})`,
		);
	}
	return { functions: abi.functions ?? [] };
}

export function registerScaffoldTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<{ contractId: string; subgraphName?: string }>(
		server,
		"subgraphs_scaffold",
		"Generate a subgraph scaffold from a deployed Stacks contract. Fetches the ABI automatically. Returns TypeScript source — review it, then pass it to subgraphs_deploy.",
		{
			contractId: z
				.string()
				.describe(
					"Fully qualified contract ID (e.g. SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01)",
				),
			subgraphName: z
				.string()
				.optional()
				.describe("Override the subgraph name (defaults to contract name)"),
		},
		async ({ contractId, subgraphName }) => {
			const { functions } = await fetchAbi(clientProvider, contractId);
			const code = generateSubgraphCode(contractId, functions, subgraphName);
			return { content: [{ type: "text", text: code }] };
		},
	);
}
