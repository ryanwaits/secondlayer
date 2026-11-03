import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ApiRequest, apiRequest, readApiKey } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

export function registerAccountTools(
	server: McpServer,
	request: ApiRequest = apiRequest,
	currentKey: () => string | undefined = readApiKey,
) {
	defineTool<Record<string, never>>(
		server,
		"account_whoami",
		"Show the archive account email at api.secondlayer.tools, not the self-host instance.",
		{},
		async () => {
			const result = await request<{ email: string }>(
				"GET",
				"/api/accounts/me",
			);
			return jsonResponse(result);
		},
	);

	defineTool<{ name?: string }>(
		server,
		"account_create_key",
		"Mint an account key (sk-sl_*) for archive credits, quote, and fetch at api.secondlayer.tools. The returned `key` is shown ONCE.",
		{
			name: z.string().optional().describe("Optional label for the key"),
		},
		async ({ name }) =>
			jsonResponse(await request("POST", "/api/keys", { name })),
	);

	defineTool<Record<string, never>>(
		server,
		"account_list_keys",
		"List this account's active account keys at api.secondlayer.tools: id, prefix, name, last read. Never returns a secret. Use an id with account_rotate_key.",
		{},
		async () => {
			const keys = await activeAccountKeys(request);
			return jsonResponse({ keys });
		},
	);

	defineTool<{ id: string }>(
		server,
		"account_rotate_key",
		"Replace an account key's secret at api.secondlayer.tools, keeping its name. The old secret gets 401 at once, with no grace period, so everything using it breaks until updated: get human confirmation first. The returned key is shown ONCE. Refuses the key this server runs on.",
		{
			id: z.string().uuid().describe("Key id from account_list_keys"),
		},
		async ({ id }) => {
			const { keys } = await request<{ keys: ListedKey[] }>("GET", "/api/keys");
			const row = keys.find((k) => k.id === id);
			if (row && currentKey()?.startsWith(row.prefix)) {
				throw new Error(
					"This server runs on that key and can't update its own env. Rotate it with the secondlayer CLI or on /account/keys, then restart the server.",
				);
			}
			return jsonResponse(await request("POST", `/api/keys/${id}/rotate`, {}));
		},
	);
}

/** The slice of a `GET /api/keys` row these tools use. */
interface ListedKey {
	id: string;
	prefix: string;
	status: string;
	product: string;
	rowsDaily?: number[];
}

async function activeAccountKeys(request: ApiRequest) {
	const { keys } = await request<{ keys: ListedKey[] }>("GET", "/api/keys");
	return keys
		.filter((k) => k.status === "active" && k.product === "account")
		.map(({ rowsDaily: _rowsDaily, ...rest }) => rest);
}
