import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;

export function registerInstanceTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
) {
	defineTool<Record<string, never>>(
		server,
		"instance_status",
		"Decoder health and empty-index diagnosis from GET /public/status. If state is empty-index, next tool is archive_bootstrap or setup. Poll until index.decoders are ok before treating Index as ready — do not start decoders. Then archive_verify, then codegen_index_schema. Do not download parquet.",
		{},
		async () => {
			const client = clientProvider();
			const status = await client.instance.status();
			const diagnosis = await client.instance.diagnose();
			return jsonResponse({ status, diagnosis });
		},
	);
}
