import { Hono } from "hono";
import { getDb, jsonb, sql } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import type { Stream, StreamMetrics, UpdateStreamRow } from "@secondlayer/shared/db";
import {
  CreateStreamSchema,
  UpdateStreamSchema,
  StreamNotFoundError,
  ValidationError,
} from "@secondlayer/shared";
import { generateSecret } from "@secondlayer/shared/crypto/hmac";
import { enqueue } from "@secondlayer/shared/queue";
import { assertStreamOwnership, getApiKeyId, getAccountId, getAccountKeyIds } from "../lib/ownership.ts";
import { enforceLimits } from "../middleware/enforce-limits.ts";

const app = new Hono();

// Enforce stream creation limit
app.post("/", enforceLimits("streams"));

// Helper to format stream response
function formatStream(
  stream: Stream,
  metrics?: StreamMetrics | null,
) {
  return {
    id: stream.id,
    name: stream.name,
    status: stream.status,
    enabled: stream.status === "active" || stream.status === "paused",
    webhookUrl: stream.webhook_url,
    filters: parseJsonb(stream.filters),
    options: parseJsonb(stream.options),
    lastTriggeredAt: metrics?.last_triggered_at?.toISOString() ?? null,
    lastTriggeredBlock: metrics?.last_triggered_block ?? null,
    totalDeliveries: metrics?.total_deliveries ?? 0,
    failedDeliveries: metrics?.failed_deliveries ?? 0,
    errorMessage: metrics?.error_message ?? null,
    createdAt: stream.created_at.toISOString(),
    updatedAt: stream.updated_at.toISOString(),
  };
}

/** Resolve account key IDs for the current request */
async function resolveKeyIds(c: any) {
  const db = getDb();
  const accountId = getAccountId(c);
  if (!accountId) return undefined;
  return getAccountKeyIds(db, accountId);
}

// Create stream
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = CreateStreamSchema.parse(body);

  const db = getDb();
  const apiKeyId = getApiKeyId(c);

  // Generate webhook secret
  const webhookSecret = generateSecret();

  const stream = await db
    .insertInto("streams")
    .values({
      name: parsed.name,
      webhook_url: parsed.webhookUrl,
      webhook_secret: webhookSecret,
      filters: jsonb(parsed.filters),
      options: jsonb(parsed.options ?? {}),
      status: "active",
      api_key_id: apiKeyId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Initialize metrics row
  await db.insertInto("stream_metrics").values({ stream_id: stream.id }).execute();

  return c.json(
    {
      stream: formatStream(stream),
      webhookSecret,
    },
    201
  );
});

// List streams (paginated, scoped by account)
app.get("/", async (c) => {
  const db = getDb();
  const keyIds = await resolveKeyIds(c);
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  let query = db
    .selectFrom("streams")
    .leftJoin("stream_metrics", "streams.id", "stream_metrics.stream_id")
    .selectAll("streams")
    .select([
      "stream_metrics.last_triggered_at",
      "stream_metrics.last_triggered_block",
      "stream_metrics.total_deliveries",
      "stream_metrics.failed_deliveries",
      "stream_metrics.error_message",
    ])
    .orderBy("streams.created_at", "desc")
    .limit(limit)
    .offset(offset);

  if (keyIds) {
    query = query.where("streams.api_key_id", "in", keyIds);
  }

  const results = await query.execute();

  // Get total count (scoped)
  let countQuery = db
    .selectFrom("streams")
    .select(sql<number>`count(*)`.as("count"));

  if (keyIds) {
    countQuery = countQuery.where("api_key_id", "in", keyIds);
  }

  const countResult = await countQuery.executeTakeFirst();
  const total = countResult?.count ?? 0;

  return c.json({
    streams: results.map((r) => {
      const stream: Stream = {
        id: r.id,
        name: r.name,
        status: r.status,
        filters: r.filters,
        options: r.options,
        webhook_url: r.webhook_url,
        webhook_secret: r.webhook_secret,
        api_key_id: r.api_key_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
      };
      const metrics: StreamMetrics | null = r.total_deliveries != null
        ? {
            stream_id: r.id,
            last_triggered_at: r.last_triggered_at,
            last_triggered_block: r.last_triggered_block,
            total_deliveries: r.total_deliveries!,
            failed_deliveries: r.failed_deliveries!,
            error_message: r.error_message,
          }
        : null;
      return formatStream(stream, metrics);
    }),
    total,
  });
});

// Pause all active streams (scoped by account)
app.post("/pause", async (c) => {
  const keyIds = await resolveKeyIds(c);

  let query = getDb()
    .updateTable("streams")
    .set({ status: "paused", updated_at: new Date() })
    .where("status", "=", "active");

  if (keyIds) {
    query = query.where("api_key_id", "in", keyIds);
  }

  const updated = await query.returningAll().execute();

  return c.json({
    paused: updated.length,
    streams: updated.map((s) => formatStream(s)),
  });
});

// Resume all paused streams (scoped by account)
app.post("/resume", async (c) => {
  const keyIds = await resolveKeyIds(c);

  let query = getDb()
    .updateTable("streams")
    .set({ status: "active", updated_at: new Date() })
    .where("status", "=", "paused");

  if (keyIds) {
    query = query.where("api_key_id", "in", keyIds);
  }

  const updated = await query.returningAll().execute();

  return c.json({
    resumed: updated.length,
    streams: updated.map((s) => formatStream(s)),
  });
});

// Get stream by ID
app.get("/:id", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const result = await db
    .selectFrom("streams")
    .leftJoin("stream_metrics", "streams.id", "stream_metrics.stream_id")
    .selectAll("streams")
    .select([
      "stream_metrics.last_triggered_at",
      "stream_metrics.last_triggered_block",
      "stream_metrics.total_deliveries",
      "stream_metrics.failed_deliveries",
      "stream_metrics.error_message",
    ])
    .where("streams.id", "=", id)
    .executeTakeFirst();

  if (!result) {
    throw new StreamNotFoundError(id);
  }

  const stream: Stream = {
    id: result.id,
    name: result.name,
    status: result.status,
    filters: result.filters,
    options: result.options,
    webhook_url: result.webhook_url,
    webhook_secret: result.webhook_secret,
    api_key_id: result.api_key_id,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
  const metrics: StreamMetrics | null = result.total_deliveries != null
    ? {
        stream_id: result.id,
        last_triggered_at: result.last_triggered_at,
        last_triggered_block: result.last_triggered_block,
        total_deliveries: result.total_deliveries!,
        failed_deliveries: result.failed_deliveries!,
        error_message: result.error_message,
      }
    : null;

  return c.json(formatStream(stream, metrics));
});

// Update stream
app.patch("/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const parsed = UpdateStreamSchema.parse(body);

  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  const existing = await assertStreamOwnership(db, id, keyIds);

  const updates: UpdateStreamRow = {
    updated_at: new Date(),
  };

  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.webhookUrl !== undefined) updates.webhook_url = parsed.webhookUrl;
  if (parsed.filters !== undefined) updates.filters = jsonb(parsed.filters) as any;
  if (parsed.options !== undefined) {
    updates.options = jsonb({ ...parseJsonb<object>(existing.options), ...parsed.options }) as any;
  }

  const updated = await db
    .updateTable("streams")
    .set(updates)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  return c.json(formatStream(updated));
});

// Delete stream
app.delete("/:id", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const result = await db
    .deleteFrom("streams")
    .where("id", "=", id)
    .returningAll()
    .execute();

  if (result.length === 0) {
    throw new StreamNotFoundError(id);
  }

  return c.json({ deleted: true, id });
});

// Enable stream
app.post("/:id/enable", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  const existing = await assertStreamOwnership(db, id, keyIds);

  if (existing.status !== "inactive" && existing.status !== "failed") {
    throw new ValidationError(`Cannot enable stream with status '${existing.status}'`);
  }

  const updated = await db
    .updateTable("streams")
    .set({ status: "active", updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Clear error message in metrics
  await db
    .updateTable("stream_metrics")
    .set({ error_message: null })
    .where("stream_id", "=", id)
    .execute();

  return c.json(formatStream(updated));
});

// Disable stream
app.post("/:id/disable", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const updated = await db
    .updateTable("streams")
    .set({ status: "inactive", updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    throw new StreamNotFoundError(id);
  }

  return c.json(formatStream(updated));
});

// Rotate webhook secret
app.post("/:id/rotate-secret", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const newSecret = generateSecret();

  const updated = await getDb()
    .updateTable("streams")
    .set({ webhook_secret: newSecret, updated_at: new Date() })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    throw new StreamNotFoundError(id);
  }

  return c.json({
    ...formatStream(updated),
    webhookSecret: newSecret,
  });
});

// Trigger evaluation for a specific block
app.post("/:id/trigger", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const blockHeight = body.blockHeight;

  if (typeof blockHeight !== "number" || blockHeight < 0) {
    throw new ValidationError("blockHeight must be a positive number");
  }

  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const block = await db
    .selectFrom("blocks")
    .selectAll()
    .where("height", "=", blockHeight)
    .executeTakeFirst();

  if (!block) {
    throw new ValidationError(`Block ${blockHeight} not found in database`);
  }

  const jobId = await enqueue(id, blockHeight, false);

  return c.json({
    jobId,
    streamId: id,
    blockHeight,
    message: "Evaluation job enqueued",
  });
});

// Replay - create jobs for a block range
async function replayBlocks(db: ReturnType<typeof getDb>, streamId: string, fromBlock: number, toBlock: number) {
  if (typeof fromBlock !== "number" || fromBlock < 0) {
    throw new ValidationError("fromBlock must be a non-negative number");
  }
  if (typeof toBlock !== "number" || toBlock < 0) {
    throw new ValidationError("toBlock must be a non-negative number");
  }
  if (fromBlock > toBlock) {
    throw new ValidationError("fromBlock must be less than or equal to toBlock");
  }

  const availableBlocks = await db
    .selectFrom("blocks")
    .select("height")
    .where("height", ">=", fromBlock)
    .where("height", "<=", toBlock)
    .where("canonical", "=", true)
    .orderBy("height", "asc")
    .execute();

  if (availableBlocks.length === 0) {
    throw new ValidationError(
      `No blocks found in range ${fromBlock}-${toBlock}`
    );
  }

  const jobIds: string[] = [];
  for (const block of availableBlocks) {
    const jobId = await enqueue(streamId, block.height, false);
    jobIds.push(jobId);
  }

  return {
    streamId,
    fromBlock: availableBlocks[0]!.height,
    toBlock: availableBlocks[availableBlocks.length - 1]!.height,
    jobCount: jobIds.length,
    message: `Enqueued ${jobIds.length} replay jobs`,
  };
}

app.post("/:id/replay", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const result = await replayBlocks(db, id, body.fromBlock, body.toBlock);
  return c.json(result);
});

// Backfill - deprecated, use /replay instead
app.post("/:id/backfill", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const result = await replayBlocks(db, id, body.fromBlock, body.toBlock);
  c.header("X-Deprecated", "Use POST /:id/replay instead");
  return c.json(result);
});

// Replay failed deliveries
app.post("/:id/replay-failed", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  const failedDeliveryBlocks = await db
    .selectFrom("deliveries")
    .select("block_height")
    .distinct()
    .where("stream_id", "=", id)
    .where("status", "=", "failed")
    .orderBy("block_height", "asc")
    .execute();

  if (failedDeliveryBlocks.length === 0) {
    return c.json({
      streamId: id,
      jobCount: 0,
      message: "No failed deliveries to replay",
    });
  }

  const jobIds: string[] = [];
  for (const { block_height } of failedDeliveryBlocks) {
    const jobId = await enqueue(id, block_height, false);
    jobIds.push(jobId);
  }

  return c.json({
    streamId: id,
    jobCount: jobIds.length,
    message: `Enqueued ${jobIds.length} replay jobs`,
  });
});

// Get recent deliveries for a stream
app.get("/:id/deliveries", async (c) => {
  const { id } = c.req.param();
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const status = c.req.query("status");

  if (status && status !== "success" && status !== "failed") {
    throw new ValidationError("status must be 'success' or 'failed'");
  }

  const db = getDb();
  const keyIds = await resolveKeyIds(c);

  await assertStreamOwnership(db, id, keyIds);

  let query = db
    .selectFrom("deliveries")
    .selectAll()
    .where("stream_id", "=", id)
    .orderBy("created_at", "desc")
    .limit(limit);

  if (status) {
    query = query.where("status", "=", status);
  }

  const results = await query.execute();

  return c.json({
    deliveries: results.map((d) => ({
      id: d.id,
      blockHeight: d.block_height,
      status: d.status,
      statusCode: d.status_code,
      responseTimeMs: d.response_time_ms,
      attempts: d.attempts,
      error: d.error,
      createdAt: d.created_at.toISOString(),
    })),
  });
});

export default app;
