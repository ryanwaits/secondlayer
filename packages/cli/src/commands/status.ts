import { Command } from "commander";
import { loadConfig, resolveApiUrl } from "../lib/config.ts";
import { authHeaders } from "../lib/api-client.ts";
import { green, red, yellow, dim, blue, formatKeyValue } from "../lib/output.ts";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show system status")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      const config = await loadConfig();

      try {
        const response = await fetch(`${resolveApiUrl(config)}/status`, {
          headers: authHeaders(config),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const status = await response.json();

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        printStatus(status);
      } catch {
        console.log("");
        console.log(blue("System Status"));
        console.log(`  ${red("NOT RUNNING")}`);
        console.log("");
        if (config.network === "local") {
          console.log(dim("  API service is not running."));
          console.log(dim("  Start with: sl dev start"));
        } else {
          console.log(dim(`  Can't reach ${config.network} API at ${resolveApiUrl(config)}`));
          console.log(dim("  Check your connection or try again."));
        }
        console.log("");
        process.exit(1);
      }
    });
}

function printStatus(status: any): void {
  console.log("");

  // Overall status
  const statusColor = status.status === "healthy" ? green : red;
  console.log(blue("System Status"));
  console.log(`  ${statusColor(status.status.toUpperCase())}${status.network ? dim(` (${status.network})`) : ""}`);
  console.log("");

  // Database
  console.log(blue("Database"));
  const dbColor = status.database.status === "ok" ? green : red;
  console.log(`  Status: ${dbColor(status.database.status)}`);
  console.log("");

  // Queue
  console.log(blue("Job Queue"));
  console.log(
    formatKeyValue([
      ["  Pending", status.queue.pending.toString()],
      ["  Processing", status.queue.processing.toString()],
      ["  Completed", status.queue.completed.toString()],
      ["  Failed", status.queue.failed.toString()],
    ])
  );
  console.log("");

  // Index Progress
  console.log(blue("Index Progress"));
  if (status.indexProgress.length === 0) {
    console.log(dim("  No data indexed yet"));
  } else {
    for (const p of status.indexProgress) {
      const behind = p.highestSeenBlock - p.lastIndexedBlock;
      const behindStr = behind > 0 ? yellow(` (${behind} behind)`) : green(" (synced)");
      console.log(`  ${p.network}: block ${p.lastIndexedBlock}${behindStr}`);

      // Chain tip progress bar
      if (status.chainTip && status.chainTip > 0) {
        const pct = Math.min((p.lastIndexedBlock / status.chainTip) * 100, 100);
        const barWidth = 30;
        const filled = Math.round((pct / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
        const pctStr = pct.toFixed(1) + "%";
        const color = pct >= 99.9 ? green : pct >= 50 ? yellow : red;
        console.log(`  ${dim("chain:")} ${color(bar)} ${color(pctStr)} ${dim(`(tip: ${status.chainTip.toLocaleString()})`)}`);
      }

      // Contiguous + integrity info
      const contiguous = p.lastContiguousBlock ?? 0;
      if (status.integrity === "complete") {
        console.log(`  ${dim("contiguous:")} ${contiguous} ${green("(complete)")}`);
      } else {
        const gapCount = status.gaps?.length ?? 0;
        const missing = status.totalMissingBlocks ?? 0;
        console.log(`  ${dim("contiguous:")} ${contiguous} ${yellow(`(${gapCount} gaps, ${missing} missing blocks)`)}`);
        if (status.gaps) {
          for (const gap of status.gaps.slice(0, 5)) {
            const range = gap.gapStart === gap.gapEnd
              ? `${gap.gapStart}`
              : `${gap.gapStart}-${gap.gapEnd}`;
            console.log(`    ${dim("gap:")} ${range} ${dim(`(${gap.size} block${gap.size > 1 ? "s" : ""})`)}`);
          }
        }
      }
    }
  }
  console.log("");

  // Streams
  console.log(blue("Streams"));
  console.log(
    formatKeyValue([
      ["  Total", status.streams.total.toString()],
      ["  Active", green(status.streams.active.toString())],
      ["  Paused", yellow(status.streams.paused.toString())],
      ["  Error", status.streams.error > 0 ? red(status.streams.error.toString()) : "0"],
    ])
  );
  console.log("");

  // Views + Deliveries (hosted mode fields)
  if (status.activeViews !== undefined || status.recentDeliveries !== undefined) {
    console.log(blue("Activity"));
    const pairs: [string, string][] = [];
    if (status.activeViews !== undefined) pairs.push(["  Active Views", status.activeViews.toString()]);
    if (status.recentDeliveries !== undefined) pairs.push(["  Deliveries (24h)", status.recentDeliveries.toString()]);
    console.log(formatKeyValue(pairs));
    console.log("");
  }

  console.log(dim(`Last updated: ${status.timestamp}`));
}
