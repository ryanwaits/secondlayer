import { Command } from "commander";
import { listStreams } from "../lib/api-client.ts";
import { error, formatTable, green, red, yellow, dim } from "../lib/output.ts";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List all streams")
    .option("-s, --status <status>", "Filter by status (inactive/active/paused/failed)")
    .option("--json", "Output as JSON")
    .action(
      async (options: { status?: string; json?: boolean }) => {
        try {
          const { streams, total } = await listStreams({
            status: options.status,
          });

          if (options.json) {
            console.log(JSON.stringify(streams, null, 2));
            return;
          }

          if (streams.length === 0) {
            console.log("No streams found");
            return;
          }

          const rows = (streams as Array<{ id: string; name: string; status: string; totalDeliveries: number }>).map((s) => {
            const statusColor =
              s.status === "active"
                ? green
                : s.status === "failed"
                  ? red
                  : s.status === "paused"
                    ? yellow
                    : dim;
            return [
              s.id.slice(0, 8),
              s.name,
              statusColor(s.status),
              s.totalDeliveries.toString(),
            ];
          });

          console.log(
            formatTable(
              ["ID", "Name", "Status", "Deliveries"],
              rows
            )
          );
          console.log(dim(`\n${total} stream(s) total`));
        } catch (err) {
          error(`Failed to list streams: ${err}`);
          process.exit(1);
        }
      }
    );
}
