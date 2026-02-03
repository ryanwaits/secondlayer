import { Hono } from "hono";
import { sql } from "kysely";
import { getDb } from "@secondlayer/shared/db";
import { stats as queueStats } from "@secondlayer/shared/queue";
import { findGaps, countMissingBlocks } from "@secondlayer/shared/db/queries/integrity";

const app = new Hono();

// Simple health check
app.get("/health", async (c) => {
  return c.json({ status: "ok" });
});

// Detailed status
app.get("/status", async (c) => {
  const db = getDb();

  // Check database connection
  let dbStatus = "ok";
  try {
    await sql`SELECT 1`.execute(db);
  } catch {
    dbStatus = "error";
  }

  // Get queue stats
  let queue = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
  try {
    queue = await queueStats();
  } catch {
    // Queue stats unavailable
  }

  // Get index progress per network
  let progress: Array<{
    network: string;
    lastIndexedBlock: number;
    lastContiguousBlock: number;
    highestSeenBlock: number;
    updatedAt: string;
  }> = [];
  try {
    const results = await db.selectFrom("index_progress").selectAll().execute();
    progress = results.map((p) => ({
      network: p.network,
      lastIndexedBlock: p.last_indexed_block,
      lastContiguousBlock: p.last_contiguous_block,
      highestSeenBlock: p.highest_seen_block,
      updatedAt: p.updated_at.toISOString(),
    }));
  } catch {
    // Progress unavailable
  }

  // Get stream counts
  let streamCounts = { total: 0, inactive: 0, active: 0, paused: 0, failed: 0 };
  try {
    const results = await db
      .selectFrom("streams")
      .select([
        "status",
        sql<number>`count(*)`.as("count"),
      ])
      .groupBy("status")
      .execute();

    streamCounts.total = results.reduce((sum, r) => sum + r.count, 0);
    for (const r of results) {
      if (r.status === "inactive") streamCounts.inactive = r.count;
      if (r.status === "active") streamCounts.active = r.count;
      if (r.status === "paused") streamCounts.paused = r.count;
      if (r.status === "failed") streamCounts.failed = r.count;
    }
  } catch {
    // Stream counts unavailable
  }

  // Get indexer stats (ephemeral counters)
  let indexerStats = { blocksReceivedOutOfOrder: 0 };
  try {
    const indexerUrl = process.env.INDEXER_URL || "http://localhost:3700";
    const res = await fetch(`${indexerUrl}/health`);
    if (res.ok) {
      const data = await res.json() as { blocksReceivedOutOfOrder?: number };
      indexerStats.blocksReceivedOutOfOrder = data.blocksReceivedOutOfOrder ?? 0;
    }
  } catch {
    // Indexer health unavailable
  }

  // Get integrity info
  let gaps: Array<{ gapStart: number; gapEnd: number; size: number }> = [];
  let totalMissingBlocks = 0;
  try {
    gaps = await findGaps(db, 10);
    totalMissingBlocks = await countMissingBlocks(db);
  } catch {
    // Integrity check unavailable
  }

  // Get chain tip from public API (best-effort)
  let chainTip: number | null = null;
  try {
    const res = await fetch("https://api.mainnet.hiro.so/v2/info", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const info = (await res.json()) as { stacks_tip_height?: number };
      chainTip = info.stacks_tip_height ?? null;
    }
  } catch {
    // Chain tip unavailable — no-op
  }

  // Get recent deliveries (last 24h)
  let recentDeliveries = 0;
  try {
    const result = await db
      .selectFrom("deliveries")
      .select(sql<number>`count(*)`.as("count"))
      .where("created_at", ">=", sql<Date>`now() - interval '24 hours'`)
      .executeTakeFirst();
    recentDeliveries = result?.count ?? 0;
  } catch {
    // Deliveries count unavailable
  }

  // Get view health summary
  let viewHealth: Array<{
    name: string;
    status: string;
    lastProcessedBlock: number;
    totalProcessed: number;
    totalErrors: number;
    errorRate: number;
    lastError: string | null;
  }> = [];
  try {
    const allViews = await db.selectFrom("views").selectAll().execute();
    viewHealth = allViews.map((v) => ({
      name: v.name,
      status: v.status,
      lastProcessedBlock: v.last_processed_block,
      totalProcessed: v.total_processed,
      totalErrors: v.total_errors,
      errorRate: v.total_processed > 0
        ? parseFloat((v.total_errors / v.total_processed).toFixed(4))
        : 0,
      lastError: v.last_error ?? null,
    }));
  } catch {
    // Views unavailable
  }

  return c.json({
    status: dbStatus === "ok" ? "healthy" : "degraded",
    network: process.env.STACKS_NETWORK || "mainnet",
    database: {
      status: dbStatus,
    },
    queue,
    indexProgress: progress,
    integrity: totalMissingBlocks === 0 ? "complete" : "gaps_detected",
    gaps,
    totalMissingBlocks,
    blocksReceivedOutOfOrder: indexerStats.blocksReceivedOutOfOrder,
    streams: streamCounts,
    activeStreams: streamCounts.active,
    chainTip,
    activeViews: viewHealth.filter((v) => v.status === "active").length,
    recentDeliveries,
    views: viewHealth,
    timestamp: new Date().toISOString(),
  });
});

export default app;
