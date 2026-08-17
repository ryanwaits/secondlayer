import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamsEventType } from "@secondlayer/sdk";
import { STREAMS_EVENT_TYPES } from "@secondlayer/shared";
import { z } from "zod";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

/** A Streams principal/contract filter: one value or any value in a list. */
const filterValue = z.union([z.string(), z.array(z.string())]);

type FilterValue = string | string[];

export function registerStreamsTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"streams_tip",
		"Current canonical chain tip as Streams sees it: block height/hash, burn height, finalized_height, lag_seconds, and the oldest seekable height/cursor for this key's retention window. Call it before a cursor walk to know where the stream ends, and after an ingest to check lag.",
		{},
		async () => jsonResponse(await clientProvider().streams.tip()),
	);

	defineTool<{
		cursor?: string;
		fromHeight?: number;
		toHeight?: number;
		types?: StreamsEventType[];
		notTypes?: StreamsEventType[];
		contractId?: FilterValue;
		sender?: FilterValue;
		recipient?: FilterValue;
		assetIdentifier?: string;
		limit?: number;
	}>(
		server,
		"streams_events",
		"List raw chain events from Streams — ONE page per call, newest filters applied server-side. Returns { events, next_cursor, tip, reorgs }. To follow the chain live, poll this tool with `cursor` set to the previous response's `next_cursor` (input is exclusive, so no duplicates); there is no open-stream tool because a tool call cannot hold a connection. ALWAYS narrow with types/contractId/sender/recipient — an unfiltered page is the full firehose.",
		{
			cursor: z
				.string()
				.optional()
				.describe(
					"Resume strictly after this cursor (`<block_height>:<event_index>`, e.g. 951475:3) — pass a prior response's next_cursor",
				),
			fromHeight: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Start block height (inclusive)"),
			toHeight: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("End block height (inclusive)"),
			types: z
				.array(z.enum(STREAMS_EVENT_TYPES))
				.optional()
				.describe("Event types to include"),
			notTypes: z
				.array(z.enum(STREAMS_EVENT_TYPES))
				.optional()
				.describe("Event types to exclude (applied after types)"),
			contractId: filterValue
				.optional()
				.describe("Contract id, or a list of contract ids to OR together"),
			sender: filterValue
				.optional()
				.describe("Sender principal, or a list to OR together"),
			recipient: filterValue
				.optional()
				.describe("Recipient principal, or a list to OR together"),
			assetIdentifier: z
				.string()
				.optional()
				.describe(
					"Asset identifier (contract::asset), e.g. SP…sbtc-token::sbtc-token",
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(1000)
				.optional()
				.describe("Page size, 1–1000 (default 100)"),
		},
		async (params) =>
			jsonResponse(await clientProvider().streams.events.list(params)),
	);

	defineTool<{ txId: string }>(
		server,
		"streams_events_by_tx",
		"List every event emitted by a single transaction, in emission order. Use it to explain one transaction end to end after finding it in streams_events or the Index.",
		{
			txId: z.string().describe("Transaction id (0x-prefixed)"),
		},
		async ({ txId }) =>
			jsonResponse(await clientProvider().streams.events.byTxId(txId)),
	);

	defineTool<{ heightOrHash: string | number }>(
		server,
		"streams_block_events",
		"List every event in one block, addressed by block height or block hash. Use it to audit a block a consumer flagged, or to diff what a reorg replaced.",
		{
			heightOrHash: z
				.union([z.number().int().nonnegative(), z.string()])
				.describe("Block height (number) or block hash (0x-prefixed string)"),
		},
		async ({ heightOrHash }) =>
			jsonResponse(await clientProvider().streams.blocks.events(heightOrHash)),
	);

	defineTool<{ height: number }>(
		server,
		"streams_canonical",
		"Get the canonical block at a height: hash, burn block hash, parent, and whether the height is still canonical. Use it to confirm a height you already consumed was not reorged away before you trust derived state.",
		{
			height: z.number().int().nonnegative().describe("Block height"),
		},
		async ({ height }) =>
			jsonResponse(await clientProvider().streams.canonical(height)),
	);

	defineTool<{ since: string; limit?: number }>(
		server,
		"streams_reorgs",
		"List reorgs detected since a point in time, newest last, with the new canonical tip for each. Returns { reorgs, next_since } — resume with next_since. Call it when a consumer's derived state disagrees with streams_canonical, or on a schedule to know which heights to reprocess.",
		{
			since: z
				.string()
				.describe(
					"Required. ISO 8601 timestamp, or a `next_since` resume token from a prior response",
				),
			limit: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Max reorgs to return"),
		},
		async ({ since, limit }) =>
			jsonResponse(
				await clientProvider().streams.reorgs.list({
					since,
					...(limit !== undefined ? { limit } : {}),
				}),
			),
	);

	defineTool<Record<string, never>>(
		server,
		"streams_dumps",
		"List the Streams bulk parquet dumps manifest — coverage range, latest_finalized_cursor, and per-file metadata (block range, row count, size, sha256, signed URL). This is the cold backfill path for downloading all raw data; fetch the file URLs directly (e.g. with DuckDB). Requires the dumps base URL to be configured (SL_STREAMS_DUMPS_URL). For live reads use streams_events (cursor-paginated) and streams_tip.",
		{},
		async () => jsonResponse(await clientProvider().streams.dumps.list()),
	);
}
