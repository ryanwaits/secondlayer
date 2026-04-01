import { join } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { ensureDir, fileExists, writeTextFile } from "../lib/fs.ts";
import { error, success, warn } from "../lib/output.ts";
import { generateStreamTemplate } from "../templates/stream.ts";

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

				if (await fileExists(outputPath)) {
					warn(`File already exists: ${outputPath}`);
					process.exit(1);
				}

				// Ensure directory exists
				const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
				if (dir) {
					await ensureDir(dir);
				}

				const template = generateStreamTemplate(
					name,
					config.defaultEndpointUrl,
				);
				await writeTextFile(
					outputPath,
					JSON.stringify(template, null, 2) + "\n",
				);

				success(`Created ${outputPath}`);
				if (!config.defaultEndpointUrl) {
					warn(
						"Edit the endpointUrl before registering — it must be a reachable HTTPS endpoint",
					);
				}
				console.log("\nEdit the file to configure your stream, then run:");
				console.log(`  sl streams register ${outputPath}`);
			} catch (err) {
				error(`Failed to create stream: ${err}`);
				process.exit(1);
			}
		});
}
