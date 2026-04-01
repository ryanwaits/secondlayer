import { confirm } from "@inquirer/prompts";
import type { Command } from "commander";
import { getStream, handleApiError, rotateSecret } from "../lib/api-client.ts";
import { dim, formatKeyValue, success, warn } from "../lib/output.ts";

export function registerRotateSecretCommand(program: Command): void {
	program
		.command("rotate-secret <id>")
		.description("Generate a new signing secret for a stream")
		.option("-y, --yes", "Skip confirmation prompt")
		.action(async (id: string, options: { yes?: boolean }) => {
			try {
				const stream = (await getStream(id)) as { id: string; name: string };

				if (!options.yes) {
					const confirmed = await confirm({
						message: `Rotate signing secret for "${stream.name}"? The current secret will be invalidated.`,
						default: false,
					});
					if (!confirmed) {
						warn("Cancelled");
						return;
					}
				}

				const result = (await rotateSecret(stream.id)) as { secret: string };
				success(`Rotated signing secret for: ${stream.name}`);
				console.log(
					formatKeyValue([
						["Stream", stream.name],
						["Signing Secret", result.secret],
					]),
				);
				console.log(
					dim("\nSave the signing secret - it won't be shown again!"),
				);
			} catch (err) {
				handleApiError(err, "rotate secret");
			}
		});
}
