import { Command } from "commander";
import { loadConfig, resolveApiUrl } from "../lib/config.ts";
import {
  enableStream,
  disableStream,
  pauseAllStreams,
  resumeAllStreams,
  getQueueStats,
  updateStream,
  authHeaders,
} from "../lib/api-client.ts";
import { error, success, warn, info, dim, red } from "../lib/output.ts";

export function registerSetCommand(program: Command): void {
  program
    .command("set [id] [state]")
    .description("Set stream state (active, disabled, paused)")
    .option("--all", "Apply to all streams")
    .option("--wait", "Wait for pending jobs to complete (with paused)")
    .option("--retry", "Re-enable an errored stream")
    .option("--replay-failed", "Also replay failed deliveries (with --retry)")
    .option("-o, --option <kv...>", "Set stream option (key=value, e.g. maxRetries=5)")
    .action(async (id: string | undefined, state: string | undefined, options: {
      all?: boolean;
      wait?: boolean;
      retry?: boolean;
      replayFailed?: boolean;
      option?: string[];
    }) => {
      try {
        // --retry mode
        if (options.retry) {
          if (!id) {
            error("Stream ID is required with --retry");
            process.exit(1);
          }
          await retryStream(id, options.replayFailed);
          return;
        }

        // --all mode
        if (options.all) {
          if (!state) {
            error("State is required: sl streams set --all <active|paused>");
            process.exit(1);
          }
          await setAllStreams(state, options.wait);
          return;
        }

        // --option mode (standalone or combined with state)
        if (options.option?.length) {
          if (!id) {
            error("Stream ID is required with --option");
            process.exit(1);
          }
          const parsedOptions = parseOptions(options.option);
          await updateStream(id, { options: parsedOptions });
          success(`Updated stream options: ${Object.entries(parsedOptions).map(([k, v]) => `${k}=${v}`).join(", ")}`);
          if (!state) return;
        }

        // Single stream mode
        if (!id || !state) {
          error("Usage: sl streams set <id> <active|disabled>");
          console.log(dim("\nExamples:"));
          console.log(dim("  sl streams set <id> active"));
          console.log(dim("  sl streams set <id> disabled"));
          console.log(dim("  sl streams set --all paused --wait"));
          console.log(dim("  sl streams set <id> --retry --replay-failed"));
          console.log(dim("  sl streams set <id> --option maxRetries=5"));
          process.exit(1);
        }

        await setSingleStream(id, state);
      } catch (err) {
        error(`Failed to set stream state: ${err}`);
        process.exit(1);
      }
    });
}

async function setSingleStream(id: string, state: string): Promise<void> {
  switch (state) {
    case "active": {
      const stream = await enableStream(id) as { name: string };
      success(`Enabled stream: ${stream.name} (status: active)`);
      break;
    }
    case "disabled": {
      const stream = await disableStream(id) as { name: string };
      success(`Disabled stream: ${stream.name} (status: inactive)`);
      break;
    }
    default:
      error(`Unknown state: ${state}. Use active, disabled, or paused (with --all)`);
      process.exit(1);
  }
}

async function setAllStreams(state: string, wait?: boolean): Promise<void> {
  switch (state) {
    case "paused": {
      const result = await pauseAllStreams();
      if (result.paused === 0) {
        info("No active streams to pause");
        return;
      }
      success(`Paused ${result.paused} stream${result.paused === 1 ? "" : "s"}`);
      if (wait) {
        await waitForQueueDrain();
      }
      break;
    }
    case "active": {
      const result = await resumeAllStreams();
      if (result.resumed === 0) {
        info("No paused streams to resume");
        return;
      }
      success(`Resumed ${result.resumed} stream${result.resumed === 1 ? "" : "s"}`);
      break;
    }
    default:
      error(`Unknown state for --all: ${state}. Use active or paused`);
      process.exit(1);
  }
}

async function retryStream(id: string, replayFailed?: boolean): Promise<void> {
  const config = await loadConfig();
  const apiUrl = resolveApiUrl(config);

  // Get stream details
  const getRes = await fetch(`${apiUrl}/api/streams/${id}`, {
    headers: authHeaders(config),
  });
  if (!getRes.ok) {
    const body = await getRes.text();
    throw new Error(parseError(getRes.status, body));
  }

  const stream = (await getRes.json()) as { id: string; name: string; status: string; errorMessage: string | null };

  if (stream.status !== "failed") {
    warn(`Stream is not in failed status (current status: ${stream.status})`);
    console.log(dim("\nUse 'sl streams set <id> active' to enable an inactive stream."));
    process.exit(1);
  }

  if (stream.errorMessage) {
    console.log(red(`Previous error: ${stream.errorMessage}`));
    console.log("");
  }

  // Re-enable
  const enableRes = await fetch(`${apiUrl}/streams/${id}/enable`, {
    method: "POST",
    headers: authHeaders(config),
  });
  if (!enableRes.ok) {
    const body = await enableRes.text();
    throw new Error(parseError(enableRes.status, body));
  }

  success(`Re-enabled stream: ${stream.name}`);

  // Replay failed deliveries
  if (replayFailed) {
    info("Replaying failed deliveries...");
    const replayRes = await fetch(`${apiUrl}/streams/${id}/replay-failed`, {
      method: "POST",
      headers: authHeaders(config),
    });
    if (!replayRes.ok) {
      const body = await replayRes.text();
      warn(`Failed to replay: ${parseError(replayRes.status, body)}`);
    } else {
      const result = (await replayRes.json()) as { jobCount: number };
      success(`Enqueued ${result.jobCount} replay jobs`);
    }
  }

  console.log(dim("\nMonitor with: sl streams logs " + id + " -f"));
}

async function waitForQueueDrain(): Promise<void> {
  const POLL_INTERVAL_MS = 1000;
  process.stdout.write(dim("Waiting for jobs to complete..."));

  while (true) {
    const stats = await getQueueStats();
    const active = stats.pending + stats.processing;

    if (active === 0) {
      process.stdout.write("\n");
      success("All jobs completed");
      return;
    }

    process.stdout.write(`\r${dim(`Waiting for jobs to complete... ${active} remaining`)}`);
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

function parseOptions(kvPairs: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const kv of kvPairs) {
    const eqIndex = kv.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid option format: "${kv}". Use key=value.`);
    }
    const key = kv.slice(0, eqIndex);
    const raw = kv.slice(eqIndex + 1);

    if (raw === "true") result[key] = true;
    else if (raw === "false") result[key] = false;
    else if (raw !== "" && !isNaN(Number(raw))) result[key] = Number(raw);
    else result[key] = raw;
  }
  return result;
}

function parseError(status: number, body: string): string {
  let message = `HTTP ${status}`;
  try {
    const json = JSON.parse(body);
    message = json.error || json.message || message;
  } catch {
    if (body) message = body;
  }
  return message;
}
