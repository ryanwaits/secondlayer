import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AuthError } from "@secondlayer/sdk";
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
		fromBlock?: number;
		toBlock?: number;
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
			fromBlock: z.number().optional().describe("Start block (inclusive)"),
			toBlock: z.number().optional().describe("End block (inclusive)"),
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
}
