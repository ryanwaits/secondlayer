import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { deleteStream, getStream } from "../lib/api-client.ts";
import { success, error, warn } from "../lib/output.ts";

export function registerDeleteCommand(program: Command): void {
  program
    .command("delete <id>")
    .alias("rm")
    .description("Delete a stream")
    .option("-f, --force", "Skip confirmation prompt")
    .action(async (id: string, options: { force?: boolean }) => {
      try {
        // Get stream details first
        const stream = await getStream(id) as { id: string; name: string };

        if (!options.force) {
          const confirmed = await confirm({
            message: `Delete stream "${stream.name}" (${stream.id})?`,
            default: false,
          });

          if (!confirmed) {
            warn("Aborted");
            return;
          }
        }

        await deleteStream(id);
        success(`Deleted stream: ${stream.name}`);
      } catch (err) {
        error(`Failed to delete stream: ${err}`);
        process.exit(1);
      }
    });
}
