import { Command } from "commander";
import { loadConfig } from "../lib/config.ts";
import { error, success, info, warn, dim, yellow, green, red } from "../lib/output.ts";
import { StacksNodeClient } from "@secondlayer/shared/node";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import { findGaps, countMissingBlocks } from "@secondlayer/shared/db/queries/integrity";
import { getDb } from "@secondlayer/shared/db";
import { confirm } from "@inquirer/prompts";

const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/streams_dev";

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Fetch missing blocks and index them")
    .option("--from <block>", "Start block height")
    .option("--to <block>", "End block height")
    .option("--gaps", "Auto-detect and fill all gaps")
    .option("--concurrency <n>", "Parallel fetch limit (default: 1 for hiro, 5 for node)")
    .option("--delay <ms>", "Delay between batches in ms (default: 500 for hiro, 0 for node)")
    .option("--source <source>", "Data source: auto, hiro, node", "auto")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async function (this: Command) {
      const opts = this.opts() as {
        from?: string;
        to?: string;
        gaps?: boolean;
        concurrency?: string;
        delay?: string;
        source?: string;
        yes?: boolean;
      };

      const config = await loadConfig();
      const indexerUrl = process.env.INDEXER_URL || `http://localhost:${config.ports.indexer}`;
      let concurrency = opts.concurrency ? parseInt(opts.concurrency) : 0; // 0 = auto

      try {
        // Determine block source
        const nodeClient = new StacksNodeClient();
        const hiroClient = new HiroClient();
        let useHiro = opts.source === "hiro";
        let useNode = opts.source === "node";

        if (opts.source === "auto" || !opts.source) {
          // Try node first, fall back to Hiro
          const nodeHealthy = await nodeClient.isHealthy();
          if (nodeHealthy) {
            // Test if node can serve block data
            const testBlock = await nodeClient.getBlock(1).catch(() => null);
            if (testBlock) {
              useNode = true;
              info("Using local Stacks node for backfill");
            } else {
              useHiro = true;
              info("Node can't serve block data, using Hiro public API");
            }
          } else {
            useHiro = true;
            info("Node not reachable, using Hiro public API");
          }
        }

        // Auto-set concurrency based on source
        if (concurrency === 0) {
          concurrency = useHiro ? 1 : 5;
        }

        if (useHiro) {
          const hiroHealthy = await hiroClient.isHealthy();
          if (!hiroHealthy) {
            error(`Cannot reach Hiro API at ${hiroClient.getApiUrl()}`);
            console.log(dim("\nSet HIRO_API_URL or check your internet connection."));
            process.exit(1);
          }
          info(`Source: Hiro API (${hiroClient.getApiUrl()})`);
        } else if (useNode) {
          const nodeInfo = await nodeClient.getInfo();
          info(`Source: local node (tip: block ${nodeInfo.stacks_tip_height})`);
        }

        let ranges: Array<{ start: number; end: number }> = [];

        if (opts.gaps) {
          if (!process.env.DATABASE_URL) {
            process.env.DATABASE_URL = DEV_DATABASE_URL;
          }
          const db = getDb();
          const gaps = await findGaps(db);
          const missing = await countMissingBlocks(db);

          if (gaps.length === 0) {
            success("No gaps detected — block data is contiguous");
            process.exit(0);
          }

          info(`Found ${gaps.length} gaps, ${missing} missing blocks`);
          ranges = gaps.map((g) => ({ start: g.gapStart, end: g.gapEnd }));
        } else if (opts.from && opts.to) {
          const from = parseInt(opts.from);
          const to = parseInt(opts.to);
          if (isNaN(from) || from < 0) {
            error("--from must be a non-negative number");
            process.exit(1);
          }
          if (isNaN(to) || to < 0) {
            error("--to must be a non-negative number");
            process.exit(1);
          }
          if (from > to) {
            error("--from must be <= --to");
            process.exit(1);
          }
          ranges = [{ start: from, end: to }];
        } else {
          error("Must specify --from and --to, or --gaps");
          console.log(dim("\nExamples:"));
          console.log(dim("  sl sync --from 1000 --to 2000"));
          console.log(dim("  sl sync --gaps"));
          console.log(dim("  sl sync --gaps --source hiro"));
          process.exit(1);
        }

        const totalBlocks = ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);

        if (!opts.yes) {
          console.log("");
          const sourceLabel = useHiro ? "Hiro API" : "local node";
          console.log(`This will fetch ${yellow(totalBlocks.toString())} blocks from ${sourceLabel}.`);
          if (useHiro) {
            console.log(dim("Note: Hiro API fetches are slower due to per-tx event lookups."));
          }
          const confirmed = await confirm({
            message: "Continue?",
            default: true,
          });
          if (!confirmed) {
            info("Cancelled");
            process.exit(0);
          }
        }

        // Delay between batches: default 500ms for Hiro (be nice), 0 for node
        const batchDelay = opts.delay
          ? parseInt(opts.delay)
          : useHiro ? 500 : 0;

        if (useHiro && batchDelay > 0) {
          info(`Pacing: ${batchDelay}ms delay between batches (concurrency: ${concurrency})`);
        }

        let fetched = 0;
        let errors = 0;
        let consecutiveErrors = 0;
        const startTime = Date.now();

        for (const range of ranges) {
          const heights: number[] = [];
          for (let h = range.start; h <= range.end; h++) {
            heights.push(h);
          }

          for (let i = 0; i < heights.length; i += concurrency) {
            const batch = heights.slice(i, i + concurrency);
            const results = await Promise.allSettled(
              batch.map(async (height) => {
                let block: unknown;

                if (useHiro) {
                  block = await hiroClient.getBlockForIndexer(height);
                } else {
                  block = await nodeClient.getBlock(height);
                }

                if (!block) {
                  throw new Error(`Block ${height} not found`);
                }

                const res = await fetch(`${indexerUrl}/new_block`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Source": "backfill",
                  },
                  body: JSON.stringify(block),
                });

                if (!res.ok) {
                  throw new Error(`Indexer rejected block ${height}: ${res.status}`);
                }

                return height;
              })
            );

            for (const result of results) {
              if (result.status === "fulfilled") {
                fetched++;
                consecutiveErrors = 0;
              } else {
                errors++;
                consecutiveErrors++;
                console.log(red(`\n  ✗ ${result.reason}`));
              }
            }

            // Adaptive backoff: if we hit multiple consecutive errors, slow down
            if (consecutiveErrors >= 5) {
              const cooldown = Math.min(consecutiveErrors * 2000, 30_000);
              process.stdout.write(`\n  ${yellow(`Backing off ${cooldown / 1000}s after ${consecutiveErrors} consecutive errors...`)}`);
              await new Promise((r) => setTimeout(r, cooldown));
            }

            const elapsed = (Date.now() - startTime) / 1000;
            const rate = fetched / elapsed;
            const remaining = totalBlocks - fetched - errors;
            const eta = rate > 0 ? Math.round(remaining / rate) : 0;
            const etaStr = eta > 3600
              ? `${Math.floor(eta / 3600)}h ${Math.floor((eta % 3600) / 60)}m`
              : eta > 60
                ? `${Math.floor(eta / 60)}m ${eta % 60}s`
                : `${eta}s`;
            const pct = Math.round(((fetched + errors) / totalBlocks) * 100);
            process.stdout.write(`\r  ${green(`${fetched}`)} fetched, ${errors > 0 ? red(`${errors} errors`) : "0 errors"} (${pct}%) ${dim(`${rate.toFixed(1)} blk/s — ETA ${etaStr}`)}   `);

            // Pace requests
            if (batchDelay > 0) {
              await new Promise((r) => setTimeout(r, batchDelay));
            }
          }
        }

        console.log("");
        console.log("");

        if (errors === 0) {
          success(`Backfill complete: ${fetched} blocks indexed`);
        } else {
          warn(`Backfill complete: ${fetched} indexed, ${errors} errors`);
        }

        process.exit(0);
      } catch (err) {
        error(`Backfill failed: ${err}`);
        process.exit(1);
      }
    });
}
