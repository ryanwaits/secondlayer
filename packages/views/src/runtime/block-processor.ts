import { sql } from "kysely";
import { getDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { updateViewStatus, recordViewProcessed } from "@secondlayer/shared/db/queries/views";
import type { ViewDefinition } from "../types.ts";
import { pgSchemaName } from "../schema/utils.ts";
import { ViewContext, type BlockMeta, type TxMeta } from "./context.ts";
import { matchSources } from "./source-matcher.ts";
import { runHandlers } from "./runner.ts";

export interface ProcessBlockResult {
  blockHeight: number;
  matched: number;
  processed: number;
  errors: number;
  skipped: boolean;
}

/**
 * Process a single block through a single view's pipeline.
 *
 * Flow:
 * 1. Load block + txs + events from DB
 * 2. Run source matcher
 * 3. Run handlers with ViewContext
 * 4. Flush context (commit writes atomically)
 * 5. Update view.last_processed_block
 */
export interface ProcessBlockOptions {
  /** Skip updating last_processed_block in DB (reindex batches this externally). */
  skipProgressUpdate?: boolean;
}

export async function processBlock(
  view: ViewDefinition,
  viewName: string,
  blockHeight: number,
  opts?: ProcessBlockOptions,
): Promise<ProcessBlockResult> {
  const db = getDb();
  const result: ProcessBlockResult = {
    blockHeight,
    matched: 0,
    processed: 0,
    errors: 0,
    skipped: false,
  };

  // 1. Load block
  const block = await db
    .selectFrom("blocks")
    .selectAll()
    .where("height", "=", blockHeight)
    .executeTakeFirst();

  if (!block) {
    logger.warn("Block not found for view processing", { view: viewName, blockHeight });
    result.skipped = true;
    return result;
  }

  if (!block.canonical) {
    logger.debug("Skipping non-canonical block", { view: viewName, blockHeight });
    result.skipped = true;
    return result;
  }

  // 2. Load txs + events
  const txs = await db
    .selectFrom("transactions")
    .selectAll()
    .where("block_height", "=", blockHeight)
    .execute();

  const evts = await db
    .selectFrom("events")
    .selectAll()
    .where("block_height", "=", blockHeight)
    .execute();

  // 3. Match source
  const matched = matchSources(view.sources, txs, evts);
  result.matched = matched.length;

  if (matched.length === 0) {
    if (!opts?.skipProgressUpdate) {
      await updateViewStatus(db, viewName, "active", blockHeight);
    }
    return result;
  }

  // 4. Create context and run handlers
  // Use stored schema_name from DB if available, otherwise compute
  const viewRecord = await db
    .selectFrom("views")
    .select("schema_name")
    .where("name", "=", viewName)
    .executeTakeFirst();
  const schemaName = viewRecord?.schema_name ?? pgSchemaName(viewName);
  const blockMeta: BlockMeta = {
    height: block.height,
    hash: block.hash,
    timestamp: block.timestamp,
    burnBlockHeight: block.burn_block_height,
  };
  const initialTx: TxMeta = {
    txId: "",
    sender: "",
    type: "",
    status: "",
  };

  // Wrap entire block processing in a single transaction
  await db.transaction().execute(async (tx) => {
    const ctx = new ViewContext(tx, schemaName, view.schema, blockMeta, initialTx);
    const runResult = await runHandlers(view, matched, ctx);
    result.processed = runResult.processed;
    result.errors = runResult.errors;

    // 5. Flush writes
    if (ctx.pendingOps > 0) {
      await ctx.flush();
    }

    // 6. Update progress + health metrics (same transaction)
    if (!opts?.skipProgressUpdate) {
      const status = runResult.errors > 0 && runResult.processed === 0 ? "error" : "active";
      await updateViewStatus(tx, viewName, status, blockHeight);
    }

    if (!opts?.skipProgressUpdate && (runResult.processed > 0 || runResult.errors > 0)) {
      const lastError = runResult.errors > 0
        ? `${runResult.errors} error(s) at block ${blockHeight}`
        : undefined;
      await recordViewProcessed(tx, viewName, runResult.processed, runResult.errors, lastError);
    }
  });

  // 7. Row count warning — sample every 1000 blocks
  if (blockHeight % 1000 === 0) {
    try {
      const tables = Object.keys(view.schema);
      for (const table of tables) {
        const { rows } = await sql.raw(
          `SELECT COUNT(*) as count FROM "${schemaName}"."${table}"`,
        ).execute(db);
        const count = Number((rows[0] as Record<string, unknown>).count);
        if (count >= 10_000_000) {
          logger.warn("View table exceeds 10M rows", { view: viewName, table, count });
        }
      }
    } catch {
      // Table may not exist yet
    }
  }

  return result;
}
