import type { Command } from "commander";
import {
	INSTANCE_ENV_FILE,
	buildInstanceEnv,
	loadExistingInstanceEnv,
	parseInstanceNetwork,
	writeInstanceEnv,
} from "../lib/instance-init.ts";
import { formatKeyValue, note, success } from "../lib/output.ts";

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description(
			"Write local env (token, secrets key, webhook signing key). Idempotent.",
		)
		.option(
			"--network <network>",
			"mainnet, testnet, or devnet",
			process.env.STACKS_NETWORK ?? "mainnet",
		)
		.option("--api-url <url>", "Local API URL", "http://127.0.0.1:3800")
		.option("--force", "Overwrite generated values even if .env.local exists")
		.action((opts: { network: string; apiUrl: string; force?: boolean }) => {
			const network = parseInstanceNetwork(opts.network);
			const existing = opts.force ? {} : loadExistingInstanceEnv(process.cwd());
			const env = buildInstanceEnv({
				network,
				existing,
				apiUrl: opts.apiUrl,
			});
			const path = writeInstanceEnv(process.cwd(), env);
			success(`Wrote ${INSTANCE_ENV_FILE}`);
			note(
				formatKeyValue([
					["network", env.STACKS_NETWORK],
					["api", env.SL_API_URL],
					["env", path],
				]),
			);
			note(
				"Export these or pass --env-file to compose. Do not commit the file.",
			);
		});
}
