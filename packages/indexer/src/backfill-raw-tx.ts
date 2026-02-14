/**
 * Second-pass backfill: fills raw_tx hex for transactions stored with placeholder "0x00".
 *
 * Run after bulk-backfill.ts completes with BACKFILL_INCLUDE_RAW_TX=false.
 * Inherently resumable — queries WHERE raw_tx = '0x00' each iteration.
 *
 * Usage:
 *   DATABASE_URL=postgres://... bun run packages/indexer/src/backfill-raw-tx.ts
 *
 * Env vars:
 *   HIRO_API_URL                  - Primary API (default: https://api.mainnet.hiro.so)
 *   HIRO_FALLBACK_URL             - Fallback for missing txs
 *   DATABASE_URL                  - Postgres connection string
 *   BACKFILL_RAW_TX_CONCURRENCY   - Parallel API fetches (default: 10)
 *   BACKFILL_RAW_TX_BATCH_SIZE    - Txids per iteration (default: 500)
 */

import { getDb, closeDb, sql } from "@secondlayer/shared/db";
import { HiroClient } from "@secondlayer/shared/node/hiro-client";
import { logger } from "@secondlayer/shared/logger";

const CONCURRENCY = parseInt(process.env.BACKFILL_RAW_TX_CONCURRENCY || "10");
const BATCH_SIZE = parseInt(process.env.BACKFILL_RAW_TX_BATCH_SIZE || "500");

async function main() {
  const hiro = new HiroClient();
  const db = getDb();

  // Initial count
  const { rows: countRows } = await sql<{ cnt: string }>`
    SELECT COUNT(*) AS cnt FROM transactions WHERE raw_tx = '0x00'
  `.execute(db);
  let remaining = Number(countRows[0]?.cnt ?? 0);

  logger.info("backfill-raw-tx starting", { remaining, concurrency: CONCURRENCY, batchSize: BATCH_SIZE });

  if (remaining === 0) {
    logger.info("No transactions with placeholder raw_tx — done");
    await closeDb();
    return;
  }

  const startTime = Date.now();
  let totalUpdated = 0;
  let consecutiveEmpty = 0;

  while (true) {
    // Fetch batch of txids needing raw_tx
    const rows = await db
      .selectFrom("transactions")
      .select("tx_id")
      .where("raw_tx", "=", "0x00")
      .limit(BATCH_SIZE)
      .execute();

    if (rows.length === 0) break;

    const txIds = rows.map((r) => r.tx_id);

    // Fetch raw_tx from Hiro API
    const results = await hiro.fetchRawTxBatch(txIds, CONCURRENCY);

    if (results.size === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) {
        logger.warn("3 consecutive batches with 0 fetchable raw_tx — stopping to avoid infinite loop", {
          sampleTxIds: txIds.slice(0, 5),
        });
        break;
      }
      logger.warn("Batch returned 0 raw_tx", { attempted: txIds.length });
      continue;
    }
    consecutiveEmpty = 0;

    // Batch UPDATE using CASE expression
    const entries = Array.from(results.entries());
    const matchedTxIds = entries.map(([txid]) => txid);

    // Build parameterized CASE/WHEN update
    const caseFragments = entries.map(
      ([txid, rawTx]) => sql`WHEN ${txid} THEN ${rawTx}`
    );

    await sql`
      UPDATE transactions
      SET raw_tx = CASE tx_id ${sql.join(caseFragments, sql` `)} END
      WHERE tx_id IN (${sql.join(matchedTxIds.map((id) => sql`${id}`), sql`, `)})
    `.execute(db);

    totalUpdated += results.size;
    remaining -= results.size;

    // Log unfetchable txs
    const unfetched = txIds.length - results.size;
    if (unfetched > 0) {
      // Mark unfetchable txs with a sentinel so we don't retry them forever
      const unfetchedIds = txIds.filter((id) => !results.has(id));
      await sql`
        UPDATE transactions
        SET raw_tx = '0x01'
        WHERE tx_id IN (${sql.join(unfetchedIds.map((id) => sql`${id}`), sql`, `)})
      `.execute(db);
      remaining -= unfetched;
      logger.warn("Unfetchable txs marked 0x01", { count: unfetched });
    }

    // Progress
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = totalUpdated / elapsed;
    const eta = remaining > 0 ? remaining / rate : 0;

    logger.info("Batch complete", {
      updated: results.size,
      totalUpdated,
      remaining,
      rate: `${rate.toFixed(1)} tx/sec`,
      eta: `${(eta / 3600).toFixed(1)}h`,
    });
  }

  await closeDb();

  const elapsed = (Date.now() - startTime) / 1000;
  logger.info("backfill-raw-tx complete", {
    totalUpdated,
    elapsed: `${(elapsed / 3600).toFixed(2)}h`,
    rate: `${(totalUpdated / elapsed).toFixed(1)} tx/sec`,
  });
}

main().catch((err) => {
  logger.error("backfill-raw-tx fatal error", { error: err });
  process.exit(1);
});
