#!/usr/bin/env node
import { program } from "commander";
import pkg from "../package.json" with { type: "json" };

const { version } = pkg;

/**
 * CLI entry point
 */

program
  .name("secondlayer")
  .description("CLI tool for generating type-safe Stacks contract interfaces")
  .version(version);

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

program.parse();
