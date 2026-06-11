import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateSubgraphCode } from "@secondlayer/scaffold";
import type { AbiFunction, AbiMap } from "@secondlayer/scaffold";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

// Source ABIs from the platform contract registry (prod-safe). The old
// `/api/node/contracts/:id/abi` proxy is OSS/dedicated-only and 404s in prod.
async function fetchAbi(
	clientProvider: ClientProvider,
	contractId: string,
): Promise<{ functions: AbiFunction[]; maps: AbiMap[] }> {
	const contract = await clientProvider().contracts.get(contractId, {
		includeAbi: true,
	});
	if (!contract) throw new Error(`Contract not found: ${contractId}`);
	const abi = contract.abi as {
		functions?: AbiFunction[];
		maps?: AbiMap[];
	} | null;
	if (!abi) {
		throw new Error(
			`No ABI available for ${contractId} (abi_status: ${contract.abi_status})`,
		);
	}
	return { functions: abi.functions ?? [], maps: abi.maps ?? [] };
}

export function registerScaffoldTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<{ contractId: string; subgraphName?: string }>(
		server,
		"scaffold_from_contract",
		"Generate a subgraph scaffold from a deployed Stacks contract. Fetches the ABI automatically.",
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
			const { functions, maps } = await fetchAbi(clientProvider, contractId);
			const code = generateSubgraphCode(
				contractId,
				functions,
				subgraphName,
				maps,
			);
			return { content: [{ type: "text", text: code }] };
		},
	);
}
