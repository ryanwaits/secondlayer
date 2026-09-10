import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getArchiveOpsClient, getClient } from "../lib/client.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ClientProvider = typeof getClient;
type ArchiveOpsProvider = typeof getArchiveOpsClient;

const FLOW = ["bootstrap", "repair"] as const;

export function registerArchiveTools(
	server: McpServer,
	clientProvider: ClientProvider = getClient,
	archiveOpsClientProvider: ArchiveOpsProvider = getArchiveOpsClient,
) {
	defineTool<{
		against: string;
		fromBlock?: number;
		toBlock?: number;
		target?: string;
	}>(
		server,
		"archive_verify",
		"Read-only, free compare of this instance against a signed archive (POST /v1/archive/verify). unanchored means pin a key or check the URL — not that the instance is fine. After bootstrap, poll instance_status until decoders ok, then this, then codegen_index_schema. Do not download parquet.",
		{
			against: z.string().describe("Archive manifest URL"),
			fromBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("First height (inclusive)"),
			toBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Last height (inclusive)"),
			target: z.string().optional().describe("Verify target (default raw)"),
		},
		async ({ against, fromBlock, toBlock, target }) =>
			jsonResponse(
				await clientProvider().archive.verify({
					against,
					fromBlock,
					toBlock,
					target,
				}),
			),
	);

	defineTool<{ against?: string }>(
		server,
		"archive_latest",
		"Signed pointer to the official archive tree (hosted). Needs SECONDLAYER_API_KEY (sk-sl_*), not INSTANCE_TOKEN. Use the returned origin as --against for archive_bootstrap. Do not download parquet.",
		{
			against: z
				.string()
				.optional()
				.describe("Override latest.json URL (default official tree)"),
		},
		async ({ against }) =>
			jsonResponse(await archiveOpsClientProvider().archive.latest(against)),
	);

	defineTool<{ paths: string[]; flow: (typeof FLOW)[number] }>(
		server,
		"archive_quote",
		"Price a hosted archive fetch (metered). Needs SECONDLAYER_API_KEY (sk-sl_*), not INSTANCE_TOKEN. Quote happens here; bootstrap/repair also quote inside the CLI. Do not download parquet.",
		{
			paths: z.array(z.string()).describe("Partition paths to price"),
			flow: z.enum(FLOW).describe("bootstrap or repair"),
		},
		async ({ paths, flow }) =>
			jsonResponse(
				await archiveOpsClientProvider().archive.quote({ paths, flow }),
			),
	);

	defineTool<Record<string, never>>(
		server,
		"credits_balance",
		"Archive credits balance at api.secondlayer.tools. Needs SECONDLAYER_API_KEY (sk-sl_*); INSTANCE_TOKEN is the instance.",
		{},
		async () =>
			jsonResponse(await archiveOpsClientProvider().archive.credits.balance()),
	);
}
