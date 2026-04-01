import { CreateStreamSchema } from "@secondlayer/shared/schemas";
import type { Command } from "commander";
import {
	ApiError,
	createStream,
	handleApiError,
	updateStreamByName,
} from "../lib/api-client.ts";
import { fileExists, readJsonFile } from "../lib/fs.ts";
import { dim, error, formatKeyValue, success, warn } from "../lib/output.ts";

export function registerRegisterCommand(program: Command): void {
	program
		.command("register <file>")
		.description("Register a stream from a JSON configuration file")
		.option("-u, --update", "Update existing stream if name matches")
		.action(async (filePath: string, options: { update?: boolean }) => {
			try {
				if (!(await fileExists(filePath))) {
					error(`File not found: ${filePath}`);
					process.exit(1);
				}

				const content = await readJsonFile<unknown>(filePath);
				const parsed = CreateStreamSchema.safeParse(content);

				if (!parsed.success) {
					error("Invalid stream configuration:");
					for (const issue of parsed.error.issues) {
						console.log(`  - ${issue.path.join(".")}: ${issue.message}`);
					}
					process.exit(1);
				}

				const streamData = parsed.data;

				if (options.update) {
					try {
						const updated = (await updateStreamByName(
							streamData.name,
							streamData,
						)) as { id: string; name: string };
						success(`Updated stream: ${updated.name}`);
						console.log(
							formatKeyValue([
								["ID", updated.id],
								["Name", updated.name],
							]),
						);
						return;
					} catch (err) {
						if (
							err instanceof ApiError &&
							(err as { status: number }).status === 404
						) {
							warn("Stream not found, creating new...");
							// Fall through to create
						} else {
							throw err;
						}
					}
				}

				const result = (await createStream(streamData)) as {
					stream: { id: string; name: string };
					signingSecret: string;
				};
				success(`Registered stream: ${result.stream.name}`);
				console.log(
					formatKeyValue([
						["ID", result.stream.id],
						["Name", result.stream.name],
						["Signing Secret", result.signingSecret],
					]),
				);
				console.log(
					dim("\nSave the signing secret - it won't be shown again!"),
				);
			} catch (err) {
				handleApiError(err, "register stream");
			}
		});
}
