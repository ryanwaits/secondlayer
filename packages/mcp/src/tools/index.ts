import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { z } from "zod/v4";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

const INDEX_EVENT_TYPES = DECODED_EVENT_TYPES;

/** Filters shared by the height/cursor-paginated Index endpoints. */
const rangeFilters = {
	contractId: z.string().optional().describe("Filter by contract id"),
	fromHeight: z.number().optional().describe("Start block height (inclusive)"),
	toHeight: z.number().optional().describe("End block height (inclusive)"),
	cursor: z
		.string()
		.optional()
		.describe("Opaque cursor from a prior response's next_cursor"),
	limit: z.number().optional().describe("Max rows for this page"),
};

export function registerIndexTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<{
		contractId?: string;
		sender?: string;
		recipient?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_ft_transfers",
		"List decoded SIP-010 fungible-token transfers from the Index (L2 decoded layer). Anonymous reads allowed (free-tier API keys are rejected — Build+ required).",
		{
			...rangeFilters,
			sender: z.string().optional().describe("Filter by sender principal"),
			recipient: z
				.string()
				.optional()
				.describe("Filter by recipient principal"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.ftTransfers.list(params)),
	);

	defineTool<{
		contractId?: string;
		sender?: string;
		recipient?: string;
		assetIdentifier?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_nft_transfers",
		"List decoded SIP-009 non-fungible-token transfers from the Index. Anonymous reads allowed (free-tier keys rejected).",
		{
			...rangeFilters,
			sender: z.string().optional().describe("Filter by sender principal"),
			recipient: z
				.string()
				.optional()
				.describe("Filter by recipient principal"),
			assetIdentifier: z
				.string()
				.optional()
				.describe("Filter by asset identifier (contract::asset)"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.nftTransfers.list(params)),
	);

	defineTool<{
		eventType: (typeof INDEX_EVENT_TYPES)[number];
		contractId?: string;
		sender?: string;
		recipient?: string;
		assetIdentifier?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_events",
		"List decoded chain events from the Index by event type. Use this for event types without a dedicated tool (stx_*, ft_mint/burn, nft_mint/burn, print). For ft/nft transfers prefer index_ft_transfers / index_nft_transfers.",
		{
			eventType: z
				.enum(INDEX_EVENT_TYPES)
				.describe("Required. Decoded event type to list."),
			...rangeFilters,
			sender: z.string().optional().describe("Filter by sender principal"),
			recipient: z
				.string()
				.optional()
				.describe("Filter by recipient principal"),
			assetIdentifier: z
				.string()
				.optional()
				.describe("Filter by asset identifier where applicable"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.events.list(params)),
	);

	defineTool<{
		contractId?: string;
		functionName?: string;
		sender?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_contract_calls",
		"List decoded contract calls from the Index (function name, args, result). Note: contract-call cursors are a SEPARATE keyspace from event cursors — they are not interchangeable.",
		{
			...rangeFilters,
			functionName: z
				.string()
				.optional()
				.describe("Filter by called function name"),
			sender: z.string().optional().describe("Filter by caller principal"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.contractCalls.list(params)),
	);
}
