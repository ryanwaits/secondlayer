import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import {
	generateIndexSchema,
	INDEX_CODEGEN_TABLES,
} from "@secondlayer/subgraphs";
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

/** Height-range subset for endpoints that don't filter by contract (canonical, blocks). */
const heightFilters = {
	fromHeight: rangeFilters.fromHeight,
	toHeight: rangeFilters.toHeight,
	cursor: rangeFilters.cursor,
	limit: rangeFilters.limit,
};

/** SDK get(...) resolves null on 404; surface that as a structured not_found. */
const notFound = (message: string) =>
	jsonResponse({ error: { type: "not_found", status: 404, message } }, true);

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

	defineTool<{
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_canonical",
		"List the canonical Stacks block sequence from the Index (height + hash). Anonymous reads allowed (free-tier keys rejected).",
		{ ...heightFilters },
		async (params) =>
			jsonResponse(await clientProvider().index.canonical.list(params)),
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

	defineTool<{ ref: string }>(
		server,
		"index_block",
		"Get a single block from the Index by height or block hash. Returns not_found if unknown.",
		{
			ref: z
				.string()
				.describe("Block height (digits) or block hash (0x… string)"),
		},
		async ({ ref }) => {
			const block = await clientProvider().index.blocks.get(
				/^\d+$/.test(ref) ? Number(ref) : ref,
			);
			return block ? jsonResponse(block) : notFound(`No block for ref ${ref}`);
		},
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

	defineTool<{ txId: string }>(
		server,
		"index_transaction",
		"Get a single transaction from the Index by tx_id. Returns not_found if unknown.",
		{ txId: z.string().describe("Transaction id (0x… hash)") },
		async ({ txId }) => {
			const tx = await clientProvider().index.transactions.get(txId);
			return tx ? jsonResponse(tx) : notFound(`No transaction for ${txId}`);
		},
	);

	defineTool<{
		functionName?: string;
		stacker?: string;
		caller?: string;
		fromHeight?: number;
		toHeight?: number;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_stacking",
		"List decoded PoX-4 stacking actions from the Index (stack-stx, delegate-stx, etc.). Anonymous reads allowed (free-tier keys rejected).",
		{
			...heightFilters,
			functionName: z
				.string()
				.optional()
				.describe("Filter by PoX function name"),
			stacker: z.string().optional().describe("Filter by stacker principal"),
			caller: z.string().optional().describe("Filter by caller principal"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.stacking.list(params)),
	);

	defineTool<{
		sender?: string;
		type?: string;
		contractId?: string;
		cursor?: string;
		limit?: number;
	}>(
		server,
		"index_mempool",
		"List pending (unconfirmed) transactions from the Index mempool. Sequence-cursor paginated (no height range). Anonymous reads allowed (free-tier keys rejected).",
		{
			sender: z.string().optional().describe("Filter by sender principal"),
			type: z.string().optional().describe("Filter by transaction type"),
			contractId: z
				.string()
				.optional()
				.describe("Filter to pending calls to a single contract"),
			cursor: z
				.string()
				.optional()
				.describe("Opaque cursor from a prior response's next_cursor"),
			limit: z.number().optional().describe("Max rows for this page"),
		},
		async (params) =>
			jsonResponse(await clientProvider().index.mempool.list(params)),
	);

	defineTool<{ txId: string }>(
		server,
		"index_mempool_tx",
		"Get a single pending transaction from the Index mempool by tx_id. Returns not_found once it is mined or dropped.",
		{ txId: z.string().describe("Transaction id (0x… hash)") },
		async ({ txId }) => {
			const tx = await clientProvider().index.mempool.get(txId);
			return tx ? jsonResponse(tx) : notFound(`No pending tx for ${txId}`);
		},
	);

	defineTool<Record<string, never>>(
		server,
		"index_usage",
		"Your own Index consumption (decoded events today + this month) and tier limits. Requires a Build+ API key (anonymous reads can't report usage).",
		{},
		async () => jsonResponse(await clientProvider().index.usage()),
	);

	defineTool<{
		target?: "prisma" | "kysely" | "drizzle" | "json-schema";
		tables?: string[];
		schemaName?: string;
	}>(
		server,
		"index_codegen",
		`Generate a typed schema (Prisma, Kysely, Drizzle, or JSON-Schema) for the public Index domain tables so they can be mirrored into a BYO database with full types. Returns the schema as text. Tables: ${INDEX_CODEGEN_TABLES.join(", ")}.`,
		{
			target: z
				.enum(["prisma", "kysely", "drizzle", "json-schema"])
				.optional()
				.describe("Output target (default kysely)"),
			tables: z
				.array(z.string())
				.optional()
				.describe("Subset of Index tables (default: all)"),
			schemaName: z
				.string()
				.optional()
				.describe("Postgres schema to qualify table names with"),
		},
		async ({ target = "kysely", tables, schemaName }) => {
			const out = generateIndexSchema(target, { tables, schemaName });
			return { content: [{ type: "text", text: out }] };
		},
	);
}
