import { Command } from "commander";
import { loadConfig, resolveApiUrl } from "../lib/config.ts";
import { resolveStreamId, authHeaders } from "../lib/api-client.ts";
import { error, success, info, formatKeyValue, dim } from "../lib/output.ts";

interface ReplayResponse {
  streamId: string;
  fromBlock: number;
  toBlock: number;
  jobCount: number;
  message: string;
}

interface TriggerResponse {
  jobId: string;
  streamId: string;
  blockHeight: number;
}

interface StatusResponse {
  indexProgress: Array<{
    network: string;
    lastIndexedBlock: number;
  }>;
}

export function registerReplayCommand(program: Command): void {
  program
    .command("replay <stream-id>")
    .description("Replay blocks through a stream (re-evaluate and re-deliver)")
    .option("--from <block>", "Start block height")
    .option("--to <block>", "End block height")
    .option("--last <count>", "Replay last N blocks")
    .option("--block <height>", "Trigger evaluation for a single block")
    .option("--fixture <path>", "Load block from fixture file (only with --block)")
    .action(async (rawStreamId: string, options: {
      from?: string;
      to?: string;
      last?: string;
      block?: string;
      fixture?: string;
    }) => {
      const config = await loadConfig();

      try {
        const streamId = await resolveStreamId(rawStreamId);

        // Single-block trigger mode
        if (options.block) {
          await triggerBlock(config, streamId, options.block, options.fixture);
          return;
        }

        if (options.fixture) {
          error("--fixture can only be used with --block");
          process.exit(1);
        }

        let fromBlock: number;
        let toBlock: number;

        if (options.last) {
          const lastCount = parseInt(options.last);
          if (isNaN(lastCount) || lastCount <= 0) {
            error("--last must be a positive number");
            process.exit(1);
          }

          const statusRes = await fetch(`${resolveApiUrl(config)}/status`, {
            headers: authHeaders(config),
          });
          if (!statusRes.ok) {
            throw new Error("Failed to get index progress");
          }
          const status = (await statusRes.json()) as StatusResponse;

          const progress = status.indexProgress[0];
          if (!progress) {
            error("No index progress found");
            process.exit(1);
          }

          toBlock = Number(progress.lastIndexedBlock);
          fromBlock = Math.max(0, toBlock - lastCount + 1);

          info(`Replaying last ${lastCount} blocks (${fromBlock} to ${toBlock})`);
        } else if (options.from && options.to) {
          fromBlock = parseInt(options.from);
          toBlock = parseInt(options.to);

          if (isNaN(fromBlock) || fromBlock < 0) {
            error("--from must be a non-negative number");
            process.exit(1);
          }
          if (isNaN(toBlock) || toBlock < 0) {
            error("--to must be a non-negative number");
            process.exit(1);
          }
          if (fromBlock > toBlock) {
            error("--from must be less than or equal to --to");
            process.exit(1);
          }
        } else {
          error("Must specify --from/--to, --last, or --block");
          console.log(dim("\nExamples:"));
          console.log(dim("  sl streams replay <id> --from 100000 --to 100500"));
          console.log(dim("  sl streams replay <id> --last 1000"));
          console.log(dim("  sl streams replay <id> --block 100000"));
          console.log(dim("  sl streams replay <id> --block 100000 --fixture block.json"));
          process.exit(1);
        }

        const response = await fetch(`${resolveApiUrl(config)}/api/streams/${streamId}/replay`, {
          method: "POST",
          headers: authHeaders(config),
          body: JSON.stringify({ fromBlock, toBlock }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(parseError(response.status, body));
        }

        const result = (await response.json()) as ReplayResponse;

        success("Replay started");
        console.log(
          formatKeyValue([
            ["Stream ID", result.streamId],
            ["From Block", result.fromBlock.toString()],
            ["To Block", result.toBlock.toString()],
            ["Jobs Created", result.jobCount.toString()],
          ])
        );
        console.log(dim("\nJobs will be processed by the worker in block order."));
        console.log(dim("Use 'sl streams logs <id> -f' to monitor progress."));
      } catch (err) {
        error(`Failed to start replay: ${err}`);
        process.exit(1);
      }
    });
}

async function triggerBlock(
  config: Awaited<ReturnType<typeof loadConfig>>,
  streamId: string,
  blockStr: string,
  fixturePath?: string,
): Promise<void> {
  const blockHeight = parseInt(blockStr);
  if (isNaN(blockHeight) || blockHeight < 0) {
    error("Block height must be a non-negative number");
    process.exit(1);
  }

  // Send fixture to indexer if provided
  if (fixturePath) {
    const file = Bun.file(fixturePath);
    if (!(await file.exists())) {
      error(`Fixture file not found: ${fixturePath}`);
      process.exit(1);
    }

    const fixture = await file.json();
    const indexerUrl = process.env.INDEXER_URL || "http://localhost:3700";

    const indexerRes = await fetch(`${indexerUrl}/new_block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fixture),
    });

    if (!indexerRes.ok) {
      error(`Failed to send fixture to indexer: ${await indexerRes.text()}`);
      process.exit(1);
    }

    console.log(dim(`Sent fixture to indexer at block ${blockHeight}`));
  }

  // Trigger evaluation via API
  const response = await fetch(`${resolveApiUrl(config)}/api/streams/${streamId}/trigger`, {
    method: "POST",
    headers: authHeaders(config),
    body: JSON.stringify({ blockHeight }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(parseError(response.status, body));
  }

  const result = (await response.json()) as TriggerResponse;

  success(`Triggered evaluation for block ${blockHeight}`);
  console.log(
    formatKeyValue([
      ["Job ID", result.jobId],
      ["Stream ID", result.streamId],
      ["Block", result.blockHeight.toString()],
    ])
  );
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
