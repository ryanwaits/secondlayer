import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	generatePrintSchemaSubgraph,
	generateSubgraphCode,
	generateTokenSubgraphFromAbi,
} from "@secondlayer/scaffold";
import type { AbiFunction } from "@secondlayer/scaffold";
import type { AbiContract } from "@secondlayer/stacks/clarity";
import { z } from "zod";
import { getClient } from "../lib/client.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

// Source ABIs from the platform contract registry (prod-safe). The old
// `/api/node/contracts/:id/abi` proxy is OSS/dedicated-only and 404s in prod.
//
// Prefer observed print events (`index.printSchema`). ABI functions are a
// fallback when the contract has never printed; SIP-010/009 assets fall back
// to token-transfer scaffolds. `abi.maps` is define-map STORAGE — not print topics.
async function fetchAbi(
	clientProvider: ClientProvider,
	contractId: string,
): Promise<{ functions: AbiFunction[]; abi: AbiContract }> {
	const contract = await clientProvider().contracts.get(contractId, {
		includeAbi: true,
	});
	if (!contract) throw new Error(`Contract not found: ${contractId}`);
	const abi = contract.abi as AbiContract | null;
	if (!abi) {
		throw new Error(
			`No ABI available for ${contractId} (abi_status: ${contract.abi_status})`,
		);
	}
	return { functions: (abi.functions as AbiFunction[] | undefined) ?? [], abi };
}

export function registerScaffoldTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<{ contractId: string; subgraphName?: string }>(
		server,
		"subgraphs_scaffold",
		"Generate a subgraph from observed print events when available; ABI token transfers or public functions only when the contract has never printed. Review the TypeScript, run subgraphs_test until ok: true with written >= 1, read skipped, then subgraphs_deploy. dryRun is DDL only.",
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
			const printSchema = await clientProvider().index.printSchema(contractId);
			if (printSchema && printSchema.topics.length > 0) {
				const code = generatePrintSchemaSubgraph({
					contractId,
					name: subgraphName,
					topics: printSchema.topics,
					sample: printSchema.sample,
				});
				return { content: [{ type: "text", text: code }] };
			}

			const { functions, abi } = await fetchAbi(clientProvider, contractId);
			const token = generateTokenSubgraphFromAbi({
				contractId,
				abi,
				name: subgraphName,
			});
			if (token) {
				return { content: [{ type: "text", text: token }] };
			}

			const code = generateSubgraphCode(contractId, functions, subgraphName);
			return { content: [{ type: "text", text: code }] };
		},
	);
}
