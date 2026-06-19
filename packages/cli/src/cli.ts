#!/usr/bin/env node
import { type Command, program } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
	registerAccountCommand,
	registerConfigCommand,
	registerContextCommand,
	registerDevnetCommand,
	registerDoctorCommand,
	registerIndexCommand,
	registerKeysCommand,
	registerLocalCommand,
	registerLoginCommand,
	registerLogoutCommand,
	registerProjectCommand,
	registerStatusCommand,
	registerStreamsCommand,
	registerSubgraphsCommand,
	registerSubscriptionsCommand,
	registerWhoamiCommand,
} from "./commands/index.ts";

const { version } = pkg;

program
	.name("secondlayer")
	.alias("sl")
	.description(
		"SecondLayer CLI — dedicated Stacks indexing + real-time subgraphs",
	)
	.version(version)
	.option("--network <network>", "Override network (local, testnet, mainnet)")
	.option("--api-key <key>", "API credential (overrides SL_API_KEY)")
	.option("--api-url <url>", "API endpoint (overrides SL_API_URL)")
	.showSuggestionAfterError(true)
	.showHelpAfterError("(run `sl --help` to see available commands)");

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
  $ sl login                        # Authenticate (magic-link email)
  $ sl subgraphs create my-watcher --template sip-010-balances
  $ sl subgraphs deploy subgraphs/my-watcher.ts
  $ sl subgraphs status my-watcher
`,
);

// Getting started
program.commandsGroup("Getting started:");
program
	.command("init")
	.description("Initialize a new secondlayer.config.ts file")
	.action(async () => {
		const { init } = await import("./commands/init");
		await init();
	});
registerLoginCommand(program);
registerLogoutCommand(program);
registerWhoamiCommand(program);

// Data products
program.commandsGroup("Data products:");
registerSubgraphsCommand(program);
registerSubscriptionsCommand(program);
registerStreamsCommand(program);
registerIndexCommand(program);

// Project & codegen
program.commandsGroup("Project & codegen:");
registerProjectCommand(program);

// Clarity → TypeScript codegen. Shared options + action so it mounts as
// the canonical `sl contracts generate`.
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
  $ sl contracts generate
  $ sl contracts generate ./contracts/pool.clar -o ./src/generated.ts
  $ sl contracts generate --config secondlayer.config.ts --watch`,
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

// Account
program.commandsGroup("Account:");
registerAccountCommand(program);
registerKeysCommand(program);

program.parse();
