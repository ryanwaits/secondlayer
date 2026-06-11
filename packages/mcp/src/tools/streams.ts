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
		"streams_dumps",
		"List the Streams bulk parquet dumps manifest — coverage range, latest_finalized_cursor, and per-file metadata (block range, row count, size, sha256, signed URL). This is the cold backfill path for downloading all raw data; fetch the file URLs directly (e.g. with DuckDB). Requires the dumps base URL to be configured (SL_STREAMS_DUMPS_URL). Live Streams reads (tip, events, consume) are REST-only: see /v1/streams/* in the OpenAPI spec.",
		{},
		async () => jsonResponse(await clientProvider().streams.dumps.list()),
	);
}
