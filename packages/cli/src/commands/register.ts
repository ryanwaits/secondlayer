import { Command } from "commander";
import { CreateStreamSchema } from "@secondlayer/shared/schemas";
import { createStream, updateStreamByName, ApiError } from "../lib/api-client.ts";
import { success, error, warn, formatKeyValue, dim } from "../lib/output.ts";

// Define the CreateStream interface locally since the shared package build types it as unknown
interface CreateStreamData {
  name: string;
  webhookUrl: string;
  filters: unknown[];
  options?: unknown;
  startBlock?: number;
  endBlock?: number;
}

export function registerRegisterCommand(program: Command): void {
  program
    .command("register <file>")
    .description("Register a stream from a JSON configuration file")
    .option("-u, --update", "Update existing stream if name matches")
    .action(async (filePath: string, options: { update?: boolean }) => {
      try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
          error(`File not found: ${filePath}`);
          process.exit(1);
        }

        const content = await file.json() as unknown;
        // CreateStreamSchema is typed as unknown in the build output but works at runtime
        const parsed = (CreateStreamSchema as { safeParse: (data: unknown) => { success: true; data: CreateStreamData } | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } } }).safeParse(content);

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
            const updated = await updateStreamByName(streamData.name, streamData) as { id: string; name: string };
            success(`Updated stream: ${updated.name}`);
            console.log(
              formatKeyValue([
                ["ID", updated.id],
                ["Name", updated.name],
              ])
            );
            return;
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              warn("Stream not found, creating new...");
              // Fall through to create
            } else {
              throw err;
            }
          }
        }

        const result = await createStream(streamData) as { stream: { id: string; name: string }; webhookSecret: string };
        success(`Registered stream: ${result.stream.name}`);
        console.log(
          formatKeyValue([
            ["ID", result.stream.id],
            ["Name", result.stream.name],
            ["Webhook Secret", result.webhookSecret],
          ])
        );
        console.log(dim("\nSave the webhook secret - it won't be shown again!"));
      } catch (err) {
        error(`Failed to register stream: ${err}`);
        process.exit(1);
      }
    });
}
