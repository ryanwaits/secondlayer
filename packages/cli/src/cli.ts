#!/usr/bin/env node
import { program } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
	registerAccountCommand,
	registerBillingCommand,
	registerConfigCommand,
	registerCreateCommand,
	registerDatasetsCommand,
	registerDbCommand,
	registerDoctorCommand,
	registerLocalCommand,
	registerLoginCommand,
	registerLogoutCommand,
	registerProjectCommand,
	registerStackCommand,
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
	.option("--network <network>", "Override network (local, testnet, mainnet)");

program.hook("preAction", (thisCommand) => {
	const net = thisCommand.opts().network;
	if (net) process.env.STACKS_NETWORK = net;
});

program.addHelpText(
	"after",
	`
Quickstart:
  $ sl login                        # Authenticate (magic-link email)
  $ sl subgraphs new my-watcher --template sip-010-balances
  $ sl subgraphs deploy subgraphs/my-watcher.ts
  $ sl subgraphs status my-watcher
`,
);

// --- Code generation ---
program
	.command("generate [files...]")
	.aliases(["gen"])
	.description("Generate TypeScript interfaces from Clarity contracts")
	.option("-c, --config <path>", "Path to config file")
	.option(
		"-o, --out <path>",
		"Output file path (required when using direct files)",
	)
	.option("-k, --api-key <key>", "Stacks node API key for direct RPC URLs")
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

// Auth — top-level
registerLoginCommand(program);
registerLogoutCommand(program);
registerWhoamiCommand(program);

// Project
registerProjectCommand(program);

// Workload
registerSubgraphsCommand(program);
registerCreateCommand(program);
registerSubscriptionsCommand(program);
registerStreamsCommand(program);
registerDatasetsCommand(program);

// Ops / inspection
registerStatusCommand(program);
registerStackCommand(program);
registerDbCommand(program);
registerDoctorCommand(program);
registerConfigCommand(program);

// Local dev
registerLocalCommand(program);

// Account
registerAccountCommand(program);
registerBillingCommand(program);

program.parse();
