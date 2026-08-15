#!/usr/bin/env node
import { type Command, program } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
	registerBackupCommand,
	registerBootstrapCommand,
	registerCodegenCommand,
	registerConfigCommand,
	registerConsoleCommand,
	registerContextCommand,
	registerCreditsCommand,
	registerDevnetCommand,
	registerDoctorCommand,
	registerIndexCommand,
	registerInitCommand,
	registerLocalCommand,
	registerLoginCommand,
	registerLogoutCommand,
	registerObserverCommand,
	registerRepairCommand,
	registerRestoreCommand,
	registerStartCommand,
	registerStatusCommand,
	registerStreamsCommand,
	registerSubgraphsCommand,
	registerSubscriptionsCommand,
	registerUninstallCommand,
	registerVerifyCommand,
	registerWhoamiCommand,
} from "./commands/index.ts";

const { version } = pkg;

program
	.name("secondlayer")
	.alias("sl")
	.description("Secondlayer CLI — run a Stacks index on your own hardware")
	.version(version)
	.option("--network <network>", "Override network (local, testnet, mainnet)")
	.option("--api-key <key>", "API credential (overrides SL_API_KEY)")
	.option("--api-url <url>", "API endpoint (overrides SL_API_URL)")
	.showSuggestionAfterError(true)
	.showHelpAfterError("(run `secondlayer --help` to see available commands)");

// Funnel global flags into the env vars the auth/network layers already read,
// so a flag transparently takes precedence over its env var for every command.
program.hook("preAction", (thisCommand) => {
	const { network, apiKey, apiUrl } = thisCommand.opts();
	if (network) process.env.STACKS_NETWORK = network;
	if (apiKey) process.env.SL_API_KEY = apiKey;
	if (apiUrl) process.env.SL_API_URL = apiUrl;
});

program.addHelpText(
	"after",
	`
Quickstart:
  $ secondlayer init --network mainnet
  $ secondlayer bootstrap --against <manifest>
  $ secondlayer subgraphs create my-watcher --from-contract SP....my-contract
  $ secondlayer subgraphs deploy subgraphs/my-watcher.ts
`,
);

// Getting started
program.commandsGroup("Getting started:");
registerInitCommand(program);
registerBootstrapCommand(program);
registerObserverCommand(program);
registerStartCommand(program);
registerConsoleCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);
registerWhoamiCommand(program);

// Your data — the three surfaces, plus webhook delivery over them.
program.commandsGroup("Your data:");
registerSubgraphsCommand(program);
registerSubscriptionsCommand(program);
registerStreamsCommand(program);
registerIndexCommand(program);

// Project & codegen
program.commandsGroup("Project & codegen:");
// Canonical codegen verb. The per-product paths below (`secondlayer contracts
// generate`, `secondlayer subgraphs codegen`, `secondlayer index codegen`, …) remain as
// deprecated aliases until the next major.
registerCodegenCommand(program);

// Clarity → TypeScript codegen. Shared options + action so it mounts as
// the canonical `secondlayer contracts generate`.
const configureGenerate = (cmd: Command): Command =>
	cmd
		.option("-c, --config <path>", "Path to config file")
		.option(
			"-o, --output <path>",
			"Output file path (required when using direct files)",
		)
		.option("-k, --api-key <key>", "Stacks node API key for direct RPC URLs")
		.option("-w, --watch", "Watch for changes")
		.action(async (files, options) => {
			const { deprecatedCodegenNotice } = await import("./commands/codegen.ts");
			deprecatedCodegenNotice(
				"secondlayer contracts generate",
				"secondlayer codegen contracts",
			);
			options.out = options.output;
			const { generate } = await import("./commands/generate");
			await generate(files, options);
		});

const contracts = program
	.command("contracts")
	.description("Work with Clarity contracts");
configureGenerate(
	contracts
		.command("generate [files...]")
		.aliases(["gen"])
		.description("Generate TypeScript interfaces from Clarity contracts"),
).addHelpText(
	"after",
	`
Examples:
  $ secondlayer contracts generate
  $ secondlayer contracts generate ./contracts/pool.clar -o ./src/generated.ts
  $ secondlayer contracts generate --config secondlayer.config.ts --watch`,
);

// Local development. `devnet` (Clarinet devnet → local Secondlayer stack) is the
// supported local loop and renders here; `local` stays frozen — hidden, prints a
// deprecation notice on use (see lib/frozen.ts).
program.commandsGroup("Local development:");
registerLocalCommand(program);
registerDevnetCommand(program);

// Diagnostics
program.commandsGroup("Diagnostics:");
registerStatusCommand(program);
registerDoctorCommand(program);
registerConfigCommand(program);
registerContextCommand(program);
registerVerifyCommand(program);
registerRepairCommand(program);
registerBackupCommand(program);
registerRestoreCommand(program);
registerUninstallCommand(program);

// Archive — the history plane. Credits pay for pulling it.
program.commandsGroup("Archive:");
registerCreditsCommand(program);

program.parse();
