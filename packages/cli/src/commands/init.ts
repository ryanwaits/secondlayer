import type { Command } from "commander";
import { resolveArchivePublicKey } from "../lib/archive-reference.ts";
import {
	INSTANCE_ENV_FILE,
	buildInstanceEnv,
	instanceNetworkFromEnv,
	loadExistingInstanceEnv,
	writeInstanceEnv,
} from "../lib/instance-init.ts";
import { formatKeyValue, note, success } from "../lib/output.ts";
import { isOssMode } from "../lib/resolve-auth.ts";

const DEFAULT_INIT_API_URL = "http://127.0.0.1:3800";

export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description(
			"Write local env (token, secrets key, webhook signing key). Idempotent.",
		)
		// --network and --api-url are deliberately NOT declared here: cli.ts
		// already registers both as global options on `program`, and Commander
		// resolves a repeated flag onto the ancestor that declared it first — a
		// second, command-local copy would silently receive `undefined` instead
		// of the value the operator passed, and fall back to its own default
		// every time (that happened here, first for --network, then again for
		// --api-url). The global `preAction` hook writes the parsed values to
		// STACKS_NETWORK / SL_API_URL before this action runs; read them from
		// there. Same fix `commands/setup.ts` uses.
		.option("--force", "Overwrite generated values even if .env.local exists")
		.addHelpText(
			"after",
			`
--network <mainnet|testnet|devnet> and --api-url <url> are top-level global
flags (see \`secondlayer --help\`). Defaults: mainnet, http://127.0.0.1:3800.
`,
		)
		.action(async (opts: { force?: boolean }) => {
			const network = instanceNetworkFromEnv();
			const existing = opts.force ? {} : loadExistingInstanceEnv(process.cwd());
			const env = buildInstanceEnv({
				network,
				existing,
				apiUrl: process.env.SL_API_URL ?? DEFAULT_INIT_API_URL,
				archivePublicKeyPem: await resolveArchivePublicKey({
					envPem:
						process.env.ARCHIVE_SIGNING_PUBLIC_KEY ??
						process.env.STREAMS_SIGNING_PUBLIC_KEY,
					allowHostedApi: !isOssMode(),
				}),
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
