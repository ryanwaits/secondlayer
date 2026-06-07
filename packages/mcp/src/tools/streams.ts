import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthError } from "@secondlayer/sdk";
import type { StreamsEvent, StreamsReorg } from "@secondlayer/sdk";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { z } from "zod/v4";
import { getClient, keyHint } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

const STREAMS_EVENT_TYPES = DECODED_EVENT_TYPES;

/**
 * Streams is key-mandatory — a keyless call rejects with the SDK's `AuthError`
 * (HTTP 401), unlike the public datasets/index reads. Decorate that one case
 * with the key hint so the agent learns it must set SL_API_KEY; rethrow so
 * defineTool surfaces it as a structured `unauthorized` error.
 */
async function withStreamsAuthHint<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof AuthError) {
			throw Object.assign(new Error(err.message + keyHint), { status: 401 });
		}
		throw err;
	}
}

export function registerStreamsTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"streams_tip",
		"Get the current Streams chain tip (latest processed block + lag). Streams requires an API key (SL_API_KEY).",
		{},
		async () =>
			withStreamsAuthHint(async () =>
				jsonResponse(await clientProvider().streams.tip()),
			),
	);

	defineTool<{
		types?: (typeof STREAMS_EVENT_TYPES)[number][];
		notTypes?: (typeof STREAMS_EVENT_TYPES)[number][];
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
		"streams_events",
		"List raw chain events from the Streams firehose. Streams requires an API key (SL_API_KEY). Filter by event types, principals, contract, asset, or block range; page with cursor.",
		{
			types: z
				.array(z.enum(STREAMS_EVENT_TYPES))
				.optional()
				.describe("Event types to include"),
			notTypes: z
				.array(z.enum(STREAMS_EVENT_TYPES))
				.optional()
				.describe("Event types to exclude (applied after types)"),
			contractId: z.string().optional().describe("Filter by contract id"),
			sender: z.string().optional().describe("Filter by sender principal"),
			recipient: z
				.string()
				.optional()
				.describe("Filter by recipient principal"),
			assetIdentifier: z
				.string()
				.optional()
				.describe("Filter by asset identifier"),
			fromHeight: z
				.number()
				.optional()
				.describe("Start block height (inclusive)"),
			toHeight: z.number().optional().describe("End block height (inclusive)"),
			cursor: z
				.string()
				.optional()
				.describe("Opaque cursor from a prior response"),
			limit: z.number().optional().describe("Max events for this page"),
		},
		async (params) =>
			withStreamsAuthHint(async () =>
				jsonResponse(await clientProvider().streams.events.list(params)),
			),
	);

	defineTool<{
		fromCursor?: string;
		types?: (typeof STREAMS_EVENT_TYPES)[number][];
		notTypes?: (typeof STREAMS_EVENT_TYPES)[number][];
		contractId?: string;
		sender?: string;
		recipient?: string;
		assetIdentifier?: string;
		batchSize?: number;
		maxPages?: number;
		finalizedOnly?: boolean;
	}>(
		server,
		"streams_consume",
		"Consume a bounded, reorg-aware run of Streams events from a cursor. Walks up to maxPages pages and returns the events, any reorgs observed, and a resume `cursor` to pass back as fromCursor next call — the agent-native consume/resume primitive. Streams requires an API key (SL_API_KEY).",
		{
			fromCursor: z
				.string()
				.optional()
				.describe(
					"Resume cursor from a prior consume (omit to start at genesis)",
				),
			types: z
				.array(z.enum(STREAMS_EVENT_TYPES))
				.optional()
				.describe("Event types to include"),
			notTypes: z
				.array(z.enum(STREAMS_EVENT_TYPES))
				.optional()
				.describe("Event types to exclude"),
			contractId: z.string().optional().describe("Filter by contract id"),
			sender: z.string().optional().describe("Filter by sender principal"),
			recipient: z
				.string()
				.optional()
				.describe("Filter by recipient principal"),
			assetIdentifier: z
				.string()
				.optional()
				.describe("Filter by asset identifier"),
			batchSize: z
				.number()
				.optional()
				.describe("Events per page (1–1000, default 100)"),
			maxPages: z
				.number()
				.optional()
				.describe("Max pages to walk this call (1–20, default 5)"),
			finalizedOnly: z
				.boolean()
				.optional()
				.describe("Only emit finalized events; skip reorg handling"),
		},
		async (params) =>
			withStreamsAuthHint(async () => {
				const maxPages = Math.min(Math.max(params.maxPages ?? 5, 1), 20);
				const batchSize = Math.min(Math.max(params.batchSize ?? 100, 1), 1000);
				const events: StreamsEvent[] = [];
				const reorgs: StreamsReorg[] = [];
				const result = await clientProvider().streams.events.consume({
					fromCursor: params.fromCursor ?? null,
					mode: "bounded",
					finalizedOnly: params.finalizedOnly,
					types: params.types,
					notTypes: params.notTypes,
					contractId: params.contractId,
					sender: params.sender,
					recipient: params.recipient,
					assetIdentifier: params.assetIdentifier,
					batchSize,
					maxPages,
					onBatch: (batch) => {
						events.push(...batch);
					},
					onReorg: (reorg) => {
						reorgs.push(reorg);
					},
				});
				return jsonResponse({
					events,
					reorgs,
					cursor: result.cursor,
					pages: result.pages,
				});
			}),
	);

	defineTool<{ txId: string }>(
		server,
		"streams_event_by_txid",
		"List all Streams events emitted by a single transaction. Streams requires an API key (SL_API_KEY).",
		{ txId: z.string().describe("Transaction id (0x… hash)") },
		async ({ txId }) =>
			withStreamsAuthHint(async () =>
				jsonResponse(await clientProvider().streams.events.byTxId(txId)),
			),
	);

	defineTool<{ heightOrHash: string }>(
		server,
		"streams_block_events",
		"List all Streams events in a single block, by height or block hash. Streams requires an API key (SL_API_KEY).",
		{
			heightOrHash: z
				.string()
				.describe("Block height (digits) or block hash (0x… string)"),
		},
		async ({ heightOrHash }) =>
			withStreamsAuthHint(async () =>
				jsonResponse(
					await clientProvider().streams.blocks.events(
						/^\d+$/.test(heightOrHash) ? Number(heightOrHash) : heightOrHash,
					),
				),
			),
	);

	defineTool<{ since: string; limit?: number }>(
		server,
		"streams_reorgs",
		"List chain reorgs observed by Streams since a cursor. Streams requires an API key (SL_API_KEY).",
		{
			since: z
				.string()
				.describe("Cursor to list reorgs since (block:index or ISO timestamp)"),
			limit: z.number().optional().describe("Max reorgs to return"),
		},
		async (params) =>
			withStreamsAuthHint(async () =>
				jsonResponse(await clientProvider().streams.reorgs.list(params)),
			),
	);

	defineTool<{ height: number }>(
		server,
		"streams_canonical",
		"Get the canonical block at a given height from Streams (height + hashes + is_canonical). Streams requires an API key (SL_API_KEY).",
		{ height: z.number().describe("Block height") },
		async ({ height }) =>
			withStreamsAuthHint(async () =>
				jsonResponse(await clientProvider().streams.canonical(height)),
			),
	);

	defineTool<Record<string, never>>(
		server,
		"streams_usage",
		"Your own Streams consumption (events today + this month) and tier limits (rate limit, retention). Streams requires an API key (SL_API_KEY).",
		{},
		async () =>
			withStreamsAuthHint(async () =>
				jsonResponse(await clientProvider().streams.usage()),
			),
	);

	defineTool<Record<string, never>>(
		server,
		"streams_dumps",
		"List the Streams bulk parquet dumps manifest — coverage range, latest_finalized_cursor, and per-file metadata (block range, row count, size, sha256, signed URL). This is the cold backfill path for downloading all raw data; fetch the file URLs directly (e.g. with DuckDB). Requires the dumps base URL to be configured (SL_STREAMS_DUMPS_URL).",
		{},
		async () => jsonResponse(await clientProvider().streams.dumps.list()),
	);
}
