import type { Command } from "commander";
import {
	INSTANCE_ENV_FILE,
	buildInstanceEnv,
	loadExistingInstanceEnv,
	parseInstanceNetwork,
	writeInstanceEnv,
} from "../lib/instance-init.ts";
import {
	defaultObserverEndpoint,
	parseObserverMode,
	parseRecoverySource,
	renderObserverStanza,
} from "../lib/observer-stanza.ts";
import { formatKeyValue, note, success, writeData } from "../lib/output.ts";
import { attachBootstrapCommand } from "./bootstrap.ts";

export function registerInstanceCommand(program: Command): void {
	const instance = program
		.command("instance")
		.description("Initialize, bootstrap, and configure a local instance");

	instance
		.command("init")
		.description(
			"Write local instance env (token, secrets key, webhook signing key). Idempotent.",
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

	attachBootstrapCommand(
		instance
			.command("bootstrap")
			.description(
				"Restore chain history from a verified archive into this instance",
			),
	);

	instance
		.command("observer")
		.description(
			"Print the Stacks events_observer stanza for this instance mode",
		)
		.option(
			"--mode <mode>",
			"indexer (retry) or signer-shared (no retry)",
			"indexer",
		)
		.option("--endpoint <host:port>", "Observer callback the node will POST to")
		.option(
			"--recovery <source>",
			"Required for signer-shared: journal or archive",
		)
		.option(
			"--network <network>",
			"mainnet, testnet, or devnet",
			process.env.STACKS_NETWORK ?? "mainnet",
		)
		.action(
			(opts: {
				mode: string;
				endpoint?: string;
				network: string;
				recovery?: string;
			}) => {
				const mode = parseObserverMode(opts.mode);
				const network = parseInstanceNetwork(opts.network);
				const endpoint = opts.endpoint ?? defaultObserverEndpoint(network);
				const recovery = opts.recovery
					? parseRecoverySource(opts.recovery)
					: undefined;
				if (mode === "signer-shared") {
					note(
						"Signer-shared nodes skip observer retries. Pair with a journal or archive for completeness.",
					);
				}
				writeData(renderObserverStanza({ mode, endpoint, network, recovery }));
			},
		);
}
