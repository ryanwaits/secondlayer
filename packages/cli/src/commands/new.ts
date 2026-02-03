import { Command } from "commander";
import { join } from "node:path";
import { generateStreamTemplate } from "../templates/stream.ts";
import { success, error, warn } from "../lib/output.ts";
import { loadConfig } from "../lib/config.ts";

const STREAMS_DIR = "streams";

export function registerNewCommand(program: Command): void {
  program
    .command("new <name>")
    .description("Generate a new stream configuration file")
    .option("-o, --output <path>", "Output path (default: streams/<name>.json)")
    .action(async (name: string, options: { output?: string }) => {
      try {
        const config = await loadConfig();
        const outputPath = options.output || join(STREAMS_DIR, `${name}.json`);
        const file = Bun.file(outputPath);

        if (await file.exists()) {
          warn(`File already exists: ${outputPath}`);
          process.exit(1);
        }

        // Ensure directory exists
        const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
        if (dir) {
          await Bun.$`mkdir -p ${dir}`.quiet();
        }

        const template = generateStreamTemplate(name, config.defaultWebhookUrl);
        await Bun.write(outputPath, JSON.stringify(template, null, 2) + "\n");

        success(`Created ${outputPath}`);
        console.log("\nEdit the file to configure your stream, then run:");
        console.log(`  sl streams register ${outputPath}`);
      } catch (err) {
        error(`Failed to create stream: ${err}`);
        process.exit(1);
      }
    });
}
