import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { rotateSecret, getStream } from "../lib/api-client.ts";
import { error, success, formatKeyValue, dim, warn } from "../lib/output.ts";

export function registerRotateSecretCommand(program: Command): void {
  program
    .command("rotate-secret <id>")
    .description("Generate a new webhook secret for a stream")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (id: string, options: { yes?: boolean }) => {
      try {
        const stream = await getStream(id) as { id: string; name: string };

        if (!options.yes) {
          const confirmed = await confirm({
            message: `Rotate webhook secret for "${stream.name}"? The current secret will be invalidated.`,
            default: false,
          });
          if (!confirmed) {
            warn("Cancelled");
            return;
          }
        }

        const result = await rotateSecret(stream.id) as { secret: string };
        success(`Rotated webhook secret for: ${stream.name}`);
        console.log(
          formatKeyValue([
            ["Stream", stream.name],
            ["Webhook Secret", result.secret],
          ])
        );
        console.log(dim("\nSave the webhook secret - it won't be shown again!"));
      } catch (err) {
        error(`Failed to rotate secret: ${err}`);
        process.exit(1);
      }
    });
}
