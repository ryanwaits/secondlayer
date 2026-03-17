#!/usr/bin/env node
import { program } from "commander";
import pkg from "../package.json" with { type: "json" };
import {
  registerConfigCommand,
  registerSetupCommand,
  registerStreamsCommand,
  registerStatusCommand,
  registerSyncCommand,
  registerDbCommand,
  registerWebhookCommand,
  registerSubgraphsCommand,
  registerStackCommand,
  registerDoctorCommand,
  registerAuthCommand,
  registerLocalCommand,
  registerWhoamiCommand,
} from "./commands/index.ts";

const { version } = pkg;

/**
 * CLI entry point
 */

program
  .name("secondlayer")
  .alias("sl")
  .description("SecondLayer CLI — streams, subgraphs, and real-time indexing for Stacks")
  .version(version)
  .option("--network <network>", "Override network (local, testnet, mainnet)");

program.hook("preAction", (thisCommand) => {
  const net = thisCommand.opts().network;
  if (net) process.env.STACKS_NETWORK = net;
});

program.addHelpText('after', `
Quickstart:
  $ sl setup                   # Configure network + auth
  $ sl streams new my-stream   # Scaffold a stream config
  $ sl streams register streams/my-stream.json
  $ sl status                  # Check system health
`);

// --- Code generation commands (original @secondlayer/cli) ---

program
  .command("generate [files...]")
  .aliases(["gen", "codegen"])
  .description("Generate TypeScript interfaces from Clarity contracts")
  .option("-c, --config <path>", "Path to config file")
  .option("-o, --out <path>", "Output file path (required when using direct files)")
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

// --- Streams commands (from @secondlayer/cli) ---

// Core commands (API-backed, work against any environment)
registerStreamsCommand(program);
registerSubgraphsCommand(program);
registerStatusCommand(program);

// Local infrastructure commands
registerLocalCommand(program);

// Utility commands
registerStackCommand(program);
registerDbCommand(program);
registerSyncCommand(program);
registerDoctorCommand(program);
registerSetupCommand(program);
registerConfigCommand(program);
registerAuthCommand(program);
registerWhoamiCommand(program);
registerWebhookCommand(program);

program.parse();
