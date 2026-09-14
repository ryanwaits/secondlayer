import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

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

	defineTool<Record<string, never>>(
		server,
		"streams_dumps",
		"List the Streams bulk parquet dumps manifest — coverage range, latest_finalized_cursor, and per-file metadata (block range, row count, size, sha256, signed URL). This is the cold backfill path for downloading all raw data; fetch the file URLs directly (e.g. with DuckDB). Requires the dumps base URL to be configured (SL_STREAMS_DUMPS_URL). For live reads use REST GET /v1/streams/events; for tip/lag use streams_tip.",
		{},
		async () => jsonResponse(await clientProvider().streams.dumps.list()),
	);
}
