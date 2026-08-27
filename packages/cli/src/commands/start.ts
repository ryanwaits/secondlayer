import { parseRuntimeConfig } from "@secondlayer/shared/runtime";
import type { Command } from "commander";
import { note, printError, success } from "../lib/output.ts";

export function registerStartCommand(program: Command): void {
	program
		.command("start")
		.description(
			"Validate one-box runtime config and print the compose command",
		)
		.option("--print", "print the compose invocation only")
		.action((opts: { print?: boolean }) => {
			const parsed = parseRuntimeConfig({
				NETWORK: process.env.NETWORK ?? process.env.STACKS_NETWORK,
				DATABASE_URL: process.env.DATABASE_URL,
				NODE_MODE: process.env.NODE_MODE ?? "external",
				DATA_DIR: process.env.DATA_DIR ?? "/data",
				API_PORT: process.env.API_PORT ?? "3800",
				INDEXER_PORT: process.env.INDEXER_PORT ?? "3700",
				STACKS_NODE_RPC_URL: process.env.STACKS_NODE_RPC_URL,
				LISTEN_HOST: process.env.LISTEN_HOST,
				LOG_LEVEL: process.env.LOG_LEVEL,
				BITCOIN_RPC_PASSWORD: process.env.BITCOIN_RPC_PASSWORD,
			});
			if (!parsed.ok) {
				printError(parsed.errors.join("; "), {
					hint: "Set NETWORK, DATABASE_URL, and NODE_MODE (external | stacks | full).",
				});
				process.exit(1);
			}
			// NODE_MODE=stacks adds no profile: there is no bundled-stacks-only
			// compose profile (a bundled stacks-node needs Bitcoin data from
			// somewhere, and this compose doesn't wire a public RPC default for
			// it), so `stacks` means "bring your own node," same as `external`.
			const extra =
				parsed.config.NODE_MODE === "full" ? " --profile full-node" : "";
			const cmd = `docker compose -f docker/oss/docker-compose.yml${extra} up -d`;
			if (opts.print) {
				console.log(cmd);
				return;
			}
			success(
				`config ok (${parsed.config.NETWORK}, ${parsed.config.NODE_MODE})`,
			);
			console.log(cmd);
			note(
				"  console UI (optional): add --profile console, then `secondlayer console`",
			);
			note(
				"  /extended view (optional): set EXTENDED_VIEW=1, then curl http://127.0.0.1:3999/extended/v1/status",
			);
		});
}
