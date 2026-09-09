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

export function registerSetupTools(
	server: McpServer,
	exec: ExecFn = execSecondlayer,
) {
	defineTool<{
		network: "mainnet" | "testnet" | "devnet";
		nodeMode: "external" | "stacks" | "full";
		against?: string;
		dir?: string;
		skipBootstrap?: boolean;
	}>(
		server,
		"setup",
		"Non-interactive self-host onboarding (secondlayer setup --yes). If the index is empty, this or archive_bootstrap fills it. Bootstrap is metered against the official archive. After it returns, poll instance_status until index.decoders are ok, then archive_verify, then codegen_index_schema. Do not download parquet.",
		{
			network: z
				.enum(["mainnet", "testnet", "devnet"])
				.describe("Stacks network"),
			nodeMode: z
				.enum(["external", "stacks", "full"])
				.describe("Node mode: external, stacks, or full"),
			against: z.string().optional().describe("Archive manifest URL"),
			dir: z.string().optional().describe("Compose project directory"),
			skipBootstrap: z
				.boolean()
				.optional()
				.describe("Sync from genesis instead of restoring an archive"),
		},
		async ({ network, nodeMode, against, dir, skipBootstrap }) => {
			const args = ["--yes", "--network", network, "--node-mode", nodeMode];
			if (against !== undefined) args.push("--against", against);
			if (dir !== undefined) args.push("--dir", dir);
			if (skipBootstrap) args.push("--skip-bootstrap");
			return cliResponse(await exec("setup", args));
		},
	);

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
