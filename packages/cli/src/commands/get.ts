import { Command } from "commander";
import { getStream } from "../lib/api-client.ts";
import { error, formatKeyValue, green, red, yellow, dim } from "../lib/output.ts";

export function registerGetCommand(program: Command): void {
  program
    .command("get <id>")
    .description("Get details of a stream")
    .option("--json", "Output as JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      try {
        const stream = await getStream(id) as {
          id: string;
          name: string;
          status: string;
          webhookUrl: string;
          totalDeliveries: number;
          failedDeliveries: number;
          lastTriggeredAt: string | null;
          lastTriggeredBlock: number | null;
          createdAt: string;
          updatedAt: string;
          errorMessage: string | null;
          filters: unknown;
          options: unknown;
        };

        if (options.json) {
          console.log(JSON.stringify(stream, null, 2));
          return;
        }

        const statusColor =
          stream.status === "active"
            ? green
            : stream.status === "failed"
              ? red
              : stream.status === "paused"
                ? yellow
                : dim;

        console.log(
          formatKeyValue([
            ["ID", stream.id],
            ["Name", stream.name],
            ["Status", statusColor(stream.status)],
            ["Webhook URL", stream.webhookUrl],
            ["Total Deliveries", stream.totalDeliveries.toString()],
            ["Failed Deliveries", stream.failedDeliveries.toString()],
            ["Last Triggered", stream.lastTriggeredAt || dim("never")],
            ["Last Block", stream.lastTriggeredBlock?.toString() || dim("n/a")],
            ["Created", stream.createdAt],
            ["Updated", stream.updatedAt],
          ])
        );

        if (stream.errorMessage) {
          console.log(`\n${red("Error:")} ${stream.errorMessage}`);
        }

        console.log(`\n${dim("Filters:")}`);
        console.log(JSON.stringify(stream.filters, null, 2));

        console.log(`\n${dim("Options:")}`);
        console.log(JSON.stringify(stream.options, null, 2));
      } catch (err) {
        error(`Failed to get stream: ${err}`);
        process.exit(1);
      }
    });
}
