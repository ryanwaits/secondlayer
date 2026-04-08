import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpStepOptions, McpStepResult } from "@secondlayer/workflows";
import { logger } from "@secondlayer/shared/logger";

const clients = new Map<string, Client>();

function parseServerConfig(serverName: string): {
	command: string;
	args: string[];
} {
	const envKey = `MCP_SERVER_${serverName.toUpperCase()}`;
	const envValue = process.env[envKey];
	if (!envValue) {
		throw new Error(
			`MCP server "${serverName}" not configured. Set ${envKey} environment variable.`,
		);
	}
	const parts = envValue.split(/\s+/);
	return { command: parts[0], args: parts.slice(1) };
}

async function getClient(serverName: string): Promise<Client> {
	const normalized = serverName.toLowerCase();
	const existing = clients.get(normalized);
	if (existing) return existing;

	const config = parseServerConfig(normalized);
	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args,
		stderr: "pipe",
	});

	const client = new Client(
		{ name: "secondlayer-workflow-runner", version: "0.1.0" },
		{ capabilities: {} },
	);

	await client.connect(transport);
	clients.set(normalized, client);

	logger.info(`MCP client connected to "${serverName}"`, {
		command: config.command,
	});

	return client;
}

/**
 * Execute a tool call on an external MCP server.
 * On transport error, evicts dead client and retries once.
 */
export async function executeMcpStep(
	options: McpStepOptions,
): Promise<McpStepResult> {
	let client = await getClient(options.server);

	let result: Awaited<ReturnType<typeof client.callTool>>;
	try {
		result = await client.callTool({
			name: options.tool,
			arguments: options.args ?? {},
		});
	} catch (err) {
		// Transport error — evict dead client, retry once
		logger.warn(`MCP call failed, reconnecting to "${options.server}"`, {
			error: err instanceof Error ? err.message : String(err),
		});
		clients.delete(options.server.toLowerCase());
		client = await getClient(options.server);
		result = await client.callTool({
			name: options.tool,
			arguments: options.args ?? {},
		});
	}

	const content = Array.isArray(result.content)
		? result.content.map((c) => ({
				type: String(c.type),
				...(("text" in c && c.text != null) ? { text: String(c.text) } : {}),
			}))
		: [];

	return {
		content,
		isError: Boolean(result.isError),
	};
}

/** Close all MCP client connections. Called during shutdown. */
export async function closeMcpClients(): Promise<void> {
	const entries = [...clients.entries()];
	clients.clear();
	for (const [name, client] of entries) {
		try {
			await client.close();
			logger.debug(`MCP client "${name}" closed`);
		} catch (err) {
			logger.warn(`Failed to close MCP client "${name}"`, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
}
