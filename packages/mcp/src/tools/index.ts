import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { z } from "zod";
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

/** Height-range subset for endpoints that don't filter by contract (blocks). */
const heightFilters = {
	fromHeight: rangeFilters.fromHeight,
	toHeight: rangeFilters.toHeight,
	cursor: rangeFilters.cursor,
	limit: rangeFilters.limit,
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
		"List decoded SIP-010 fungible-token transfers from the Index (decoded layer). Anonymous reads allowed (free-tier API keys are rejected — Build+ required).",
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
		trait?: string;
		txContext?: boolean;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_events",
		"List decoded chain events from the Index by event type. Use this for event types without a dedicated tool (stx_*, ft_mint/burn, nft_mint/burn, print), and for trait-scoped queries: set `trait` (e.g. sip-010) to match all contracts conforming to a standard — pair with contracts_find to discover traits. For ft/nft transfers without a trait prefer index_ft_transfers / index_nft_transfers.",
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
			trait: z
				.string()
				.optional()
				.describe(
					"Match contracts conforming to a trait/standard (e.g. sip-010). Mutually exclusive with contractId; contract-keyed event types only.",
				),
			txContext: z
				.boolean()
				.optional()
				.describe(
					"Join the submitting transaction into each event (tx_sender, tx_type, tx_status, tx_contract_id, tx_function_name). For print events it's the only source of the submitting sender.",
				),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.events.list(params)),
	);

	defineTool<{
		contractId?: string;
		functionName?: string;
		sender?: string;
		trait?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_contract_calls",
		"List decoded contract calls from the Index (function name, args, result). Set `trait` (e.g. sip-010) to match calls to all contracts conforming to a standard. Note: contract-call cursors are a SEPARATE keyspace from event cursors — they are not interchangeable.",
		{
			...rangeFilters,
			functionName: z
				.string()
				.optional()
				.describe("Filter by called function name"),
			sender: z.string().optional().describe("Filter by caller principal"),
			trait: z
				.string()
				.optional()
				.describe(
					"Match contracts conforming to a trait/standard (e.g. sip-010). Mutually exclusive with contractId.",
				),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.contractCalls.list(params)),
	);

	defineTool<{
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_blocks",
		"List decoded blocks from the Index. Anonymous reads allowed (free-tier keys rejected).",
		{ ...heightFilters },
		async (params) =>
			jsonResponse(await clientProvider().index.blocks.list(params)),
	);

	defineTool<{
		type?: string;
		sender?: string;
		contractId?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_transactions",
		"List decoded transactions from the Index. Filter by type, sender, or contract. Anonymous reads allowed (free-tier keys rejected).",
		{
			...rangeFilters,
			type: z.string().optional().describe("Filter by transaction type"),
			sender: z.string().optional().describe("Filter by sender principal"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.transactions.list(params)),
	);

	defineTool<{ contractId: string }>(
		server,
		"index_print_schema",
		"Empirical per-topic print payload schemas for a contract, inferred from sampled on-chain events: each topic's fields with observed Clarity types, decoded TS types, subgraph column types, and presence rates. Use before writing print_event subgraph handlers to learn what's on e.data. Anonymous read.",
		{
			contractId: z
				.string()
				.describe("Contract id (SP….name) whose print events to profile"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.printSchema(params.contractId)),
	);

	defineTool<Record<string, never>>(
		server,
		"index_discover",
		"Discover the Index vocabulary: every event type and its columns, allowed/equality filters, and required-non-null fields (and which types accept `trait`). Read this before building Index queries instead of guessing filters. Anonymous read.",
		{},
		async () => jsonResponse(await clientProvider().index.discover()),
	);

	defineTool<{
		requests: Array<{ path: string; params?: Record<string, string> }>;
	}>(
		server,
		"batch_query",
		"Run up to 10 public /v1 reads in one round trip (POST /v1/batch). Each item keeps its own auth/quota/pay-per-call semantics; results return in order with per-item status. Paths must start with /v1/index, /v1/subgraphs, /v1/streams, or /v1/contracts.",
		{
			requests: z
				.array(
					z.object({
						path: z.string().describe("Public /v1 read path"),
						params: z.record(z.string(), z.string()).optional(),
					}),
				)
				.min(1)
				.max(10)
				.describe("Read descriptors, executed concurrently"),
		},
		async (params) =>
			jsonResponse(await clientProvider().batch(params.requests)),
	);
}
