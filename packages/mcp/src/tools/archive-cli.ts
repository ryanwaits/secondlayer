import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execSecondlayer } from "../lib/exec-cli.ts";
import { jsonResponse } from "../lib/format.ts";
import { defineTool } from "../lib/tool.ts";

type ExecFn = typeof execSecondlayer;

function cliResponse(result: {
	code: number;
	stdout: string;
	stderr: string;
}) {
	return jsonResponse(result, result.code !== 0);
}

/** `archive_bootstrap` and `archive_repair`: the archive verbs that run
 *  through the local CLI (`secondlayer bootstrap` / `repair`). */
export function registerArchiveCliTools(
	server: McpServer,
	exec: ExecFn = execSecondlayer,
) {
	defineTool<{
		against: string;
		fromBlock?: number;
		toBlock?: number;
	}>(
		server,
		"archive_bootstrap",
		"Restore verified history into this instance (secondlayer bootstrap --against … --yes --json). Metered against the official archive; quote happens inside the CLI. After bootstrap, poll instance_status until decoders ok, then archive_verify, then codegen_index_schema. Do not download parquet.",
		{
			against: z.string().describe("Archive manifest URL"),
			fromBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Restore from this height instead of genesis"),
			toBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Stop at this height instead of the archive tip"),
		},
		async ({ against, fromBlock, toBlock }) => {
			const args = ["--against", against, "--yes", "--json"];
			if (fromBlock !== undefined) args.push("--from-block", String(fromBlock));
			if (toBlock !== undefined) args.push("--to-block", String(toBlock));
			return cliResponse(await exec("bootstrap", args));
		},
	);

	defineTool<{
		against: string;
		apply?: boolean;
		fromBlock?: number;
		toBlock?: number;
	}>(
		server,
		"archive_repair",
		"Plan (default) or apply a repair of local chain data against a signed archive. Metered when apply fetches from the official archive. After apply, poll instance_status until decoders ok, then archive_verify. Do not download parquet.",
		{
			against: z.string().describe("Archive manifest URL"),
			apply: z
				.boolean()
				.optional()
				.describe("Write the repair (default plan-only)"),
			fromBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("First height to consider"),
			toBlock: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe("Last height to consider"),
		},
		async ({ against, apply, fromBlock, toBlock }) => {
			const args = ["--against", against, "--json"];
			if (apply) args.push("--apply", "--yes");
			if (fromBlock !== undefined) args.push("--from-block", String(fromBlock));
			if (toBlock !== undefined) args.push("--to-block", String(toBlock));
			return cliResponse(await exec("repair", args));
		},
	);
}
