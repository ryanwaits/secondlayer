import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateContractInterface } from "@secondlayer/scaffold";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

export function registerContractTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<{
		trait: string;
		conformance?: "declared" | "inferred" | "any";
		include?: "abi";
		limit?: number;
		cursor?: string;
	}>(
		server,
		"contracts_find",
		'Discover deployed Stacks contracts conforming to a trait (e.g. "sip-010", "sip-009", "sip-013"). The discovery endpoint for "which contracts implement X". Reads are public.',
		{
			trait: z.string().describe('Required. Trait to match (e.g. "sip-010").'),
			conformance: z
				.enum(["declared", "inferred", "any"])
				.optional()
				.describe(
					"declared = parsed from source, inferred = ABI shape-match, any = either (default)",
				),
			include: z
				.literal("abi")
				.optional()
				.describe('Set to "abi" to include each contract\'s full ABI'),
			limit: z.number().optional().describe("Page size, 1–500 (default 100)"),
			cursor: z
				.string()
				.optional()
				.describe("Opaque cursor from a prior response's next_cursor"),
		},
		async (params) =>
			jsonResponse(await clientProvider().contracts.list(params)),
	);

	defineTool<{ contractId: string }>(
		server,
		"get_contract_abi",
		"Fetch a single deployed contract's ABI from the registry (prod-safe). Returns the contract's metadata + full ABI (functions, maps, variables, fungible/non-fungible tokens). Returns not_found if the contract isn't in the registry. Feed the ABI into scaffold_from_abi or generate a typed client.",
		{
			contractId: z
				.string()
				.describe("Fully qualified contract id (e.g. SP….amm-pool-v2-01)"),
		},
		async ({ contractId }) => {
			const contract = await clientProvider().contracts.get(contractId, {
				includeAbi: true,
			});
			return contract
				? jsonResponse(contract)
				: jsonResponse(
						{
							error: {
								type: "not_found",
								status: 404,
								message: `Contract not in registry: ${contractId}`,
							},
						},
						true,
					);
		},
	);

	defineTool<{ contractId: string }>(
		server,
		"generate_contract_interface",
		"Generate a typed TypeScript contract-client interface (typed methods + map/var/constant readers) from a deployed contract's ABI (fetched from the registry). Returns not_found if the contract isn't in the registry.",
		{
			contractId: z
				.string()
				.describe("Fully qualified contract id (e.g. SP….amm-pool-v2-01)"),
		},
		async ({ contractId }) => {
			const c = await clientProvider().contracts.get(contractId, {
				includeAbi: true,
			});
			if (!c || !c.abi) {
				return jsonResponse(
					{
						error: {
							type: "not_found",
							status: 404,
							message: `Contract not in registry: ${contractId}`,
						},
					},
					true,
				);
			}

			const [address, contractName] = contractId.split(".");
			const name = (contractName ?? contractId).replace(/[^a-zA-Z0-9]/g, "_");
			const code = generateContractInterface([
				{
					name,
					address,
					contractName: contractName ?? "",
					// biome-ignore lint/suspicious/noExplicitAny: registry ABI shape matches AbiContract at runtime
					abi: c.abi as any,
				},
			]);
			return { content: [{ type: "text", text: code }] };
		},
	);
}
