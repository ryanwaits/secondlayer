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
		// --network is deliberately NOT declared here: cli.ts already registers
		// a global `--network <network>` on `program`, and Commander resolves a
		// repeated flag onto the ancestor that declared it first — a second,
		// command-local `--network` would silently receive `undefined` instead
		// of the value the operator passed, and fall back to this option's own
		// default every time (that was happening here). The global `preAction`
		// hook writes the parsed value to STACKS_NETWORK before this action
		// runs; read it from there instead. Same fix `commands/setup.ts` uses.
		.option("--api-url <url>", "Local API URL", "http://127.0.0.1:3800")
		.option("--force", "Overwrite generated values even if .env.local exists")
		.addHelpText(
			"after",
			`
--network <mainnet|testnet|devnet> is the top-level global flag (see
\`secondlayer --help\`) — default mainnet, same as before.
`,
		)
		.action((opts: { apiUrl: string; force?: boolean }) => {
			const network = parseInstanceNetwork(
				process.env.STACKS_NETWORK ?? "mainnet",
			);
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
