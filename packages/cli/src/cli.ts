#!/usr/bin/env node
import { program } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
	registerAccountCommand,
	registerAuthCommand,
	registerConfigCommand,
	registerDbCommand,
	registerDoctorCommand,
	registerInstanceCommand,
	registerLocalCommand,
	registerMarketplaceCommand,
	registerStackCommand,
	registerStatusCommand,
	registerSubgraphsCommand,
	registerSyncCommand,
	registerWhoamiCommand,
} from "./commands/index.ts";

const { version } = pkg;

/**
 * CLI entry point
 */

program
	.name("secondlayer")
	.alias("sl")
	.description("SecondLayer CLI — subgraphs and real-time indexing for Stacks")
	.version(version)
	.option("--network <network>", "Override network (local, testnet, mainnet)");

program.hook("preAction", (thisCommand) => {
	const net = thisCommand.opts().network;
	if (net) process.env.STACKS_NETWORK = net;
});

program.addHelpText(
	"after",
	`
Quickstart:
  $ sl auth login                  # Authenticate
  $ sl subgraphs new my-subgraph   # Scaffold a subgraph
  $ sl status                      # Check system health
`,
);

// --- Code generation commands (original @secondlayer/cli) ---

program
	.command("generate [files...]")
	.aliases(["gen", "codegen"])
	.description("Generate TypeScript interfaces from Clarity contracts")
	.option("-c, --config <path>", "Path to config file")
	.option(
		"-o, --out <path>",
		"Output file path (required when using direct files)",
	)
	.option("-k, --api-key <key>", "Hiro API key (or set HIRO_API_KEY env var)")
	.option("-w, --watch", "Watch for changes")
	.action(async (files, options) => {
		const { generate } = await import("./commands/generate");
		await generate(files, options);
	});

program
	.command("init")
	.description("Initialize a new secondlayer.config.ts file")
	.action(async () => {
		const { init } = await import("./commands/init");
		await init();
	});

// Core commands (API-backed, work against any environment)
registerSubgraphsCommand(program);
registerMarketplaceCommand(program);
registerInstanceCommand(program);
registerStatusCommand(program);

// Local infrastructure commands
registerLocalCommand(program);

// Account + auth
registerAccountCommand(program);

// Utility commands
registerStackCommand(program);
registerDbCommand(program);
registerSyncCommand(program);
registerDoctorCommand(program);
registerConfigCommand(program);
registerAuthCommand(program);
registerWhoamiCommand(program);

program.parse();
