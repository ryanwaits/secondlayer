import { Command } from "commander";
import { loadConfig, resolveApiUrl, type Config } from "../lib/config.ts";
import { authHeaders, resolveStreamId } from "../lib/api-client.ts";
import { error, green, red, dim, formatTable } from "../lib/output.ts";

export function registerLogsCommand(program: Command): void {
  program
    .command("logs <stream-id>")
    .description("View delivery logs for a stream")
    .option("-f, --follow", "Follow logs in real-time")
    .option("-n, --limit <count>", "Number of logs to show", "20")
    .option("-s, --status <status>", "Filter by status (success|failed)")
    .action(async (streamId: string, options: { follow?: boolean; limit: string; status?: string }) => {
      const config = await loadConfig();

      try {
        const fullId = await resolveStreamId(streamId);
        if (options.follow) {
          await followLogs(resolveApiUrl(config), fullId, config, options.status);
        } else {
          await showRecentLogs(resolveApiUrl(config), fullId, parseInt(options.limit), config, options.status);
        }
      } catch (err) {
        error(`Failed to get logs: ${err}`);
        process.exit(1);
      }
    });
}

async function showRecentLogs(apiUrl: string, streamId: string, limit: number, config: Config, status?: string): Promise<void> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (status) params.set("status", status);
  const response = await fetch(`${apiUrl}/api/streams/${streamId}/deliveries?${params}`, {
    headers: authHeaders(config),
  });

  if (!response.ok) {
    const body = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      const json = JSON.parse(body);
      message = json.error || json.message || message;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }

  const data = await response.json() as { deliveries: any[] };
  const { deliveries } = data;

  if (deliveries.length === 0) {
    console.log(dim("No deliveries yet"));
    return;
  }

  const rows = deliveries.map((d: any) => {
    const statusColor = d.status === "success" ? green : red;
    const time = new Date(d.createdAt).toLocaleTimeString();
    return [
      dim(d.id.slice(0, 8)),
      d.blockHeight.toString(),
      statusColor(d.status),
      d.statusCode?.toString() || "-",
      d.responseTimeMs ? `${d.responseTimeMs}ms` : "-",
      d.attempts.toString(),
      dim(time),
    ];
  });

  console.log(
    formatTable(
      ["ID", "Block", "Status", "Code", "Time", "Attempts", "Timestamp"],
      rows
    )
  );
}

async function followLogs(apiUrl: string, streamId: string, config: Config, status?: string): Promise<void> {
  console.log(dim(`Following logs for stream ${streamId}...`));
  console.log(dim("Press Ctrl+C to stop\n"));

  const response = await fetch(`${apiUrl}/api/logs/${streamId}/stream`, {
    headers: authHeaders(config),
  });

  if (!response.ok) {
    const body = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      const json = JSON.parse(body);
      message = json.error || json.message || message;
    } catch {
      if (body) message = body;
    }
    throw new Error(message);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    let eventData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        eventData = line.slice(5).trim();
      } else if (line === "" && eventType && eventData) {
        // End of event
        if (eventType === "delivery") {
          try {
            const delivery = JSON.parse(eventData);
            if (!status || delivery.status === status) {
              printDelivery(delivery);
            }
          } catch {
            // Ignore parse errors
          }
        }
        // Reset for next event
        eventType = "";
        eventData = "";
      }
    }
  }
}

function printDelivery(d: any): void {
  const statusColor = d.status === "success" ? green : red;
  const time = new Date(d.createdAt).toLocaleTimeString();

  console.log(
    `${dim(time)} ` +
    `${statusColor(d.status.padEnd(7))} ` +
    `block=${d.blockHeight} ` +
    `code=${d.statusCode || "-"} ` +
    `time=${d.responseTimeMs ? `${d.responseTimeMs}ms` : "-"} ` +
    `attempts=${d.attempts}`
  );

  if (d.error) {
    console.log(red(`  Error: ${d.error}`));
  }
}
