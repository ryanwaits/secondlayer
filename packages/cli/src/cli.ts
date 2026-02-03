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
  registerViewsCommand,
  registerStackCommand,
  registerDoctorCommand,
  registerAuthCommand,
  registerLocalCommand,
  registerLogsCommand,
} from "./commands/index.ts";

const { version } = pkg;

/**
 * CLI entry point
 */

program
  .name("secondlayer")
  .alias("sl")
  .description("SecondLayer CLI for Stacks blockchain")
  .version(version);

// --- Code generation commands (original @secondlayer/cli) ---

program
  .command("generate [files...]")
  .alias("gen")
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
registerViewsCommand(program);
registerLogsCommand(program);
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
registerWebhookCommand(program);

program.parse();
