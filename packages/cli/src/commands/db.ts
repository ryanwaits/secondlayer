import { Command } from "commander";
import { getDb, sql } from "@secondlayer/shared/db";
import { findGaps, countMissingBlocks } from "@secondlayer/shared/db/queries/integrity";
import { StacksNodeClient } from "@secondlayer/shared/node";
import { error, success, info, warn, blue, green, dim, yellow, red } from "../lib/output.ts";
import { confirm } from "@inquirer/prompts";
import { loadDevState, isProcessRunning } from "../lib/dev-state.ts";
import { requireLocalNetwork } from "../lib/config.ts";

const DEV_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/streams_dev";

export function registerDbCommand(program: Command): void {
  const dbCmd = program
    .command("db")
    .description("Inspect indexer database tables")
    .hook("preAction", async () => { await requireLocalNetwork(); })
    .action(async () => {
      await showOverview(10);
    });

  dbCmd
    .command("blocks")
    .description("Show recent blocks")
    .option("--limit <n>", "Number of rows", "10")
    .option("--json", "Output as JSON")
    .action(async function(this: Command) {
      const opts = this.opts();
      await showBlocks(parseInt(opts.limit), opts.json);
    });

  dbCmd
    .command("txs")
    .description("Show recent transactions")
    .option("--limit <n>", "Number of rows", "10")
    .option("--json", "Output as JSON")
    .action(async function(this: Command) {
      const opts = this.opts();
      await showTransactions(parseInt(opts.limit), opts.json);
    });

  dbCmd
    .command("events")
    .description("Show recent events")
    .option("--limit <n>", "Number of rows", "10")
    .option("--json", "Output as JSON")
    .action(async function(this: Command) {
      const opts = this.opts();
      await showEvents(parseInt(opts.limit), opts.json);
    });

  dbCmd
    .command("gaps")
    .description("Show gaps in indexed block data")
    .option("--limit <n>", "Number of gaps to show", "50")
    .option("--json", "Output as JSON")
    .action(async function(this: Command) {
      const opts = this.opts();
      await showGaps(parseInt(opts.limit), opts.json);
    });

  dbCmd
    .command("reset")
    .description("Truncate all indexed data (blocks, txs, events, jobs, deliveries)")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async function(this: Command) {
      const opts = this.opts();
      await resetDatabase(opts.yes);
    });

  dbCmd
    .command("resync")
    .description("Reset database and restart indexer for fresh sync")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--backfill", "After reset, fetch all blocks from node")
    .action(async function(this: Command) {
      const opts = this.opts();
      await resyncDatabase(opts.yes, opts.backfill);
    });
}

function ensureDb() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = DEV_DATABASE_URL;
  }
  return getDb();
}

async function showOverview(_limit: number): Promise<void> {
  try {
    const db = ensureDb();

    // Get counts
    const blockCountResult = await db.selectFrom("blocks").select(sql<number>`count(*)`.as("count")).executeTakeFirst();
    const txCountResult = await db.selectFrom("transactions").select(sql<number>`count(*)`.as("count")).executeTakeFirst();
    const eventCountResult = await db.selectFrom("events").select(sql<number>`count(*)`.as("count")).executeTakeFirst();

    const blockCount = blockCountResult?.count ?? 0;
    const txCount = txCountResult?.count ?? 0;
    const eventCount = eventCountResult?.count ?? 0;

    // Get latest block
    const latest = await db
      .selectFrom("blocks")
      .select(["height", "hash", "timestamp"])
      .orderBy("height", "desc")
      .limit(1)
      .executeTakeFirst();

    console.log("");
    console.log(blue("Database Overview"));
    console.log("");
    console.log(`  Blocks:       ${green(blockCount.toString())}`);
    console.log(`  Transactions: ${green(txCount.toString())}`);
    console.log(`  Events:       ${green(eventCount.toString())}`);
    console.log("");

    if (latest) {
      const time = new Date(latest.timestamp * 1000).toISOString();
      console.log(blue("Latest Block"));
      console.log(`  Height: ${latest.height}`);
      console.log(`  Hash:   ${dim(latest.hash.slice(0, 20))}...`);
      console.log(`  Time:   ${time}`);
      console.log("");
    }

    console.log(dim(`Use 'sl db blocks|txs|events' to see records`));
    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to query database: ${err}`);
    console.log(dim("\nMake sure PostgreSQL is running."));
    console.log(dim("Run 'sl dev' to start all services."));
    process.exit(1);
  }
}

async function showBlocks(limit: number, json: boolean): Promise<void> {
  try {
    const db = ensureDb();

    const rows = await db
      .selectFrom("blocks")
      .select(["height", "hash", "timestamp", "canonical"])
      .orderBy("height", "desc")
      .limit(limit)
      .execute();

    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    }

    console.log("");
    console.log(blue(`Recent Blocks (${rows.length})`));
    console.log("");
    console.log(
      dim("  HEIGHT".padEnd(10)) +
      dim("HASH".padEnd(24)) +
      dim("TIME")
    );

    for (const row of rows) {
      const time = new Date(row.timestamp * 1000).toLocaleTimeString();
      const canonicalMark = row.canonical ? "" : yellow(" (reorg)");
      console.log(
        `  ${row.height.toString().padEnd(10)}` +
        `${row.hash.slice(0, 20)}... `.padEnd(24) +
        `${time}${canonicalMark}`
      );
    }
    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to query blocks: ${err}`);
    process.exit(1);
  }
}

async function showTransactions(limit: number, json: boolean): Promise<void> {
  try {
    const db = ensureDb();

    const rows = await db
      .selectFrom("transactions")
      .select(["tx_id", "block_height", "type", "sender", "status", "contract_id", "function_name"])
      .orderBy("block_height", "desc")
      .limit(limit)
      .execute();

    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    }

    console.log("");
    console.log(blue(`Recent Transactions (${rows.length})`));
    console.log("");
    console.log(
      dim("  BLOCK".padEnd(8)) +
      dim("TYPE".padEnd(18)) +
      dim("SENDER".padEnd(20)) +
      dim("CONTRACT/FUNCTION")
    );

    for (const row of rows) {
      const statusColor = row.status === "success" ? green : yellow;
      const contractInfo = row.contract_id
        ? `${row.contract_id.split(".")[1] || row.contract_id}${row.function_name ? `::${row.function_name}` : ""}`
        : "-";

      console.log(
        `  ${statusColor(row.block_height.toString().padEnd(8))}` +
        `${row.type.padEnd(18)}` +
        `${row.sender.slice(0, 18)}... `.padEnd(20) +
        `${contractInfo}`
      );
    }
    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to query transactions: ${err}`);
    process.exit(1);
  }
}

async function showEvents(limit: number, json: boolean): Promise<void> {
  try {
    const db = ensureDb();

    const rows = await db
      .selectFrom("events")
      .select(["block_height", "tx_id", "event_index", "type", "data"])
      .orderBy("block_height", "desc")
      .limit(limit)
      .execute();

    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      process.exit(0);
    }

    console.log("");
    console.log(blue(`Recent Events (${rows.length})`));
    console.log("");

    if (rows.length === 0) {
      console.log(dim("  No events found"));
      console.log("");
      process.exit(0);
    }

    console.log(
      dim("  BLOCK".padEnd(8)) +
      dim("INDEX".padEnd(8)) +
      dim("TYPE".padEnd(24)) +
      dim("TX")
    );

    for (const row of rows) {
      console.log(
        `  ${row.block_height.toString().padEnd(8)}` +
        `${row.event_index.toString().padEnd(8)}` +
        `${row.type.padEnd(24)}` +
        `${row.tx_id.slice(0, 16)}...`
      );
    }
    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to query events: ${err}`);
    process.exit(1);
  }
}

async function showGaps(limit: number, json: boolean): Promise<void> {
  try {
    const db = ensureDb();
    const gaps = await findGaps(db, limit);
    const missing = await countMissingBlocks(db);

    if (json) {
      console.log(JSON.stringify({ gaps, totalMissingBlocks: missing }, null, 2));
      process.exit(0);
    }

    console.log("");
    if (gaps.length === 0) {
      console.log(green("No gaps detected — block data is contiguous"));
      console.log("");
      process.exit(0);
    }

    console.log(blue(`Block Gaps (${gaps.length})`));
    console.log("");
    console.log(
      dim("  GAP_START".padEnd(14)) +
      dim("GAP_END".padEnd(14)) +
      dim("SIZE")
    );

    for (const gap of gaps) {
      console.log(
        `  ${gap.gapStart.toString().padEnd(14)}` +
        `${gap.gapEnd.toString().padEnd(14)}` +
        `${gap.size}`
      );
    }

    console.log("");
    console.log(`${yellow(gaps.length.toString())} gaps, ${red(missing.toString())} missing blocks`);
    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to query gaps: ${err}`);
    process.exit(1);
  }
}

async function resetDatabase(skipConfirm: boolean): Promise<void> {
  try {
    const db = ensureDb();

    // Get current counts for display
    const blockCount = (await db.selectFrom("blocks").select(sql<number>`count(*)`.as("count")).executeTakeFirst())?.count ?? 0;
    const txCount = (await db.selectFrom("transactions").select(sql<number>`count(*)`.as("count")).executeTakeFirst())?.count ?? 0;
    const eventCount = (await db.selectFrom("events").select(sql<number>`count(*)`.as("count")).executeTakeFirst())?.count ?? 0;

    console.log("");
    console.log(yellow("This will delete all indexed blockchain data:"));
    console.log("");
    console.log(`  ${red(blockCount.toString())} blocks`);
    console.log(`  ${red(txCount.toString())} transactions`);
    console.log(`  ${red(eventCount.toString())} events`);
    console.log(`  ${dim("+ jobs, deliveries, index_progress")}`);
    console.log("");
    console.log(dim("Note: Stream configurations will be preserved."));
    console.log("");

    if (!skipConfirm) {
      const confirmed = await confirm({
        message: "Are you sure you want to reset the database?",
        default: false,
      });

      if (!confirmed) {
        info("Cancelled");
        process.exit(0);
      }
    }

    info("Truncating tables...");

    // Truncate in order to respect foreign key constraints
    // deliveries -> jobs -> events -> transactions -> blocks
    // index_progress has no FKs
    await sql`TRUNCATE TABLE deliveries, jobs, events, transactions, blocks, index_progress RESTART IDENTITY CASCADE`.execute(db);

    console.log("");
    success("Database reset complete");
    console.log("");
    console.log(dim("Run 'sl dev restart' to restart the indexer for fresh sync."));
    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to reset database: ${err}`);
    process.exit(1);
  }
}

async function resyncDatabase(skipConfirm: boolean, backfill?: boolean): Promise<void> {
  try {
    const db = ensureDb();

    // Get current counts for display
    const blockCount = (await db.selectFrom("blocks").select(sql<number>`count(*)`.as("count")).executeTakeFirst())?.count ?? 0;

    console.log("");
    console.log(yellow("This will:"));
    console.log(`  1. Delete all indexed data (${red(blockCount.toString())} blocks)`);
    console.log("  2. Restart the indexer for fresh sync");
    if (backfill) {
      console.log("  3. Fetch all blocks from node (backfill)");
    }
    console.log("");
    console.log(dim("Note: Stream configurations will be preserved."));
    console.log("");

    if (!skipConfirm) {
      const confirmed = await confirm({
        message: "Are you sure you want to resync?",
        default: false,
      });

      if (!confirmed) {
        info("Cancelled");
        process.exit(0);
      }
    }

    // Step 1: Truncate tables
    info("Truncating tables...");
    await sql`TRUNCATE TABLE deliveries, jobs, events, transactions, blocks, index_progress RESTART IDENTITY CASCADE`.execute(db);
    console.log(green("  ✓ Database reset"));

    // Step 2: Restart indexer if dev is running
    const state = await loadDevState();
    if (state?.services?.indexer && isProcessRunning(state.services.indexer.pid)) {
      info("Restarting indexer...");

      // Kill the indexer process
      try {
        process.kill(state.services.indexer.pid, "SIGTERM");
        await Bun.sleep(1000);
      } catch {
        // Process may already be dead
      }

      // Force kill if still running
      if (isProcessRunning(state.services.indexer.pid)) {
        try {
          process.kill(state.services.indexer.pid, "SIGKILL");
        } catch {}
      }

      console.log(green("  ✓ Indexer stopped"));
      console.log("");
      info("Run 'sl dev restart' to start fresh sync");
    } else {
      console.log("");
      success("Database reset complete");
      console.log("");
      if (!backfill) {
        console.log(dim("Indexer not running. Start with 'sl dev start' to begin sync."));
      }
    }

    // Step 3: Backfill from node if requested
    if (backfill) {
      console.log("");
      info("Starting backfill from node...");

      const nodeClient = new StacksNodeClient();
      const healthy = await nodeClient.isHealthy();
      if (!healthy) {
        warn(`Cannot reach Stacks node at ${nodeClient.getRpcUrl()}`);
        console.log(dim("Run 'sl sync --from 1 --to <tip>' manually once the node is available."));
        console.log("");
        process.exit(0);
      }

      const nodeInfo = await nodeClient.getInfo();
      const tip = nodeInfo.stacks_tip_height;
      info(`Node tip: block ${tip}. Fetching blocks 1 to ${tip}...`);
      console.log(dim("This may take a while. Run 'sl sync --from 1 --to " + tip + "' if interrupted."));
      console.log("");

      // Delegate to backfill command logic
      const { loadConfig } = await import("../lib/config.ts");
      const config = await loadConfig();
      const indexerUrl = process.env.INDEXER_URL || `http://localhost:${config.ports.indexer}`;
      const concurrency = 5;

      let fetched = 0;
      let errors = 0;

      for (let i = 1; i <= tip; i += concurrency) {
        const batch: number[] = [];
        for (let j = i; j < i + concurrency && j <= tip; j++) {
          batch.push(j);
        }

        const results = await Promise.allSettled(
          batch.map(async (height) => {
            const block = await nodeClient.getBlock(height);
            if (!block) throw new Error(`Block ${height} not found`);
            const res = await fetch(`${indexerUrl}/new_block`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Source": "backfill" },
              body: JSON.stringify(block),
            });
            if (!res.ok) throw new Error(`Indexer rejected block ${height}: ${res.status}`);
          })
        );

        for (const r of results) {
          if (r.status === "fulfilled") fetched++;
          else errors++;
        }

        const pct = Math.round(((fetched + errors) / tip) * 100);
        process.stdout.write(`\r  ${green(`${fetched}`)} fetched, ${errors > 0 ? red(`${errors} errors`) : "0 errors"} (${pct}%)`);
      }

      console.log("");
      console.log("");
      if (errors === 0) {
        success(`Backfill complete: ${fetched} blocks indexed`);
      } else {
        warn(`Backfill complete: ${fetched} indexed, ${errors} errors`);
      }
    }

    console.log("");
    process.exit(0);
  } catch (err) {
    error(`Failed to resync: ${err}`);
    process.exit(1);
  }
}
