import { getDb } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import type { Job, Stream, Block } from "@secondlayer/shared/db";
import { logger, StreamNotFoundError } from "@secondlayer/shared";
import type { StreamFilter, StreamOptions } from "@secondlayer/shared/schemas";
import { evaluateFilters, type MatchResult } from "./matcher/index.ts";
import {
  buildPayload,
  dispatchWebhook,
  acquireToken,
  recordDelivery,
  countRecentFailures,
  type WebhookPayload,
} from "./webhook/index.ts";
import { incrementDeliveryCount, updateStreamMetrics } from "@secondlayer/shared/db/queries/metrics";
import { incrementDeliveries as incrementAccountDeliveries } from "@secondlayer/shared/db/queries/usage";

// Maximum consecutive failures before disabling a stream
const MAX_CONSECUTIVE_FAILURES = 10;
// Time window for counting failures (in minutes)
const FAILURE_WINDOW_MINUTES = 60;

export interface ProcessedJob {
  stream: Stream;
  block: Block | null;
  matches: MatchResult;
  payload: WebhookPayload | null;
  delivered: boolean;
}

/**
 * Process a single job - evaluate filters and deliver webhook
 */
export async function processJob(job: Job): Promise<ProcessedJob> {
  const db = getDb();
  const emptyResult: ProcessedJob = {
    stream: null as any,
    block: null,
    matches: { transactions: [], events: [], hasMatches: false },
    payload: null,
    delivered: false,
  };

  // 1. Load stream from database
  const stream = await db
    .selectFrom("streams")
    .selectAll()
    .where("id", "=", job.stream_id)
    .executeTakeFirst();

  if (!stream) {
    throw new StreamNotFoundError(job.stream_id);
  }

  emptyResult.stream = stream;

  // 2. Check if stream is active
  if (stream.status !== "active") {
    logger.debug("Skipping non-active stream", {
      streamId: stream.id,
      status: stream.status,
    });
    return emptyResult;
  }

  // 3. Load block data
  const block = await db
    .selectFrom("blocks")
    .selectAll()
    .where("height", "=", job.block_height)
    .executeTakeFirst();

  if (!block) {
    logger.warn("Block not found for job", {
      blockHeight: job.block_height,
    });
    return emptyResult;
  }

  // Skip non-canonical blocks
  if (!block.canonical) {
    logger.debug("Skipping non-canonical block", { blockHeight: block.height });
    return { ...emptyResult, block };
  }

  // 4. Load transactions and events for the block
  const txs = await db
    .selectFrom("transactions")
    .selectAll()
    .where("block_height", "=", job.block_height)
    .execute();

  const evts = await db
    .selectFrom("events")
    .selectAll()
    .where("block_height", "=", job.block_height)
    .execute();

  // 5. Evaluate filters
  const filters = parseJsonb<StreamFilter[]>(stream.filters);
  const matches = evaluateFilters(filters, txs, evts);

  if (!matches.hasMatches) {
    logger.debug("No matches for stream", {
      streamId: stream.id,
      blockHeight: block.height,
    });
    return { stream, block, matches, payload: null, delivered: false };
  }

  // 6. Build webhook payload
  const payload = buildPayload(stream, block, matches, job.backfill);

  // 7. Rate limit and deliver webhook
  const options = parseJsonb<StreamOptions>(stream.options);
  await acquireToken(stream.id, options.rateLimit || 10);

  const result = await dispatchWebhook(
    stream.webhook_url,
    payload,
    stream.webhook_secret,
    {
      maxAttempts: options.maxRetries ?? 3,
      timeoutMs: options.timeoutMs ?? 10000,
    }
  );

  // 8. Record delivery
  await recordDelivery({
    streamId: stream.id,
    jobId: job.id,
    blockHeight: block.height,
    result,
    payload,
  });

  // 9. Count delivery against account usage
  if (stream.api_key_id) {
    const apiKeyRow = await db
      .selectFrom("api_keys")
      .select("account_id")
      .where("id", "=", stream.api_key_id)
      .executeTakeFirst();
    if (apiKeyRow) {
      incrementAccountDeliveries(db, apiKeyRow.account_id).catch(console.error);
    }
  }

  // 10. Update stream metrics
  if (result.success) {
    await incrementDeliveryCount(db, stream.id, false);
    if (!job.backfill) {
      await updateStreamMetrics(db, stream.id, {
        lastTriggeredAt: new Date(),
        lastTriggeredBlock: block.height,
      });
    }

    logger.info("Webhook delivered", {
      streamId: stream.id,
      blockHeight: block.height,
      matchedTxs: matches.transactions.length,
      matchedEvents: matches.events.length,
    });
  } else {
    await incrementDeliveryCount(db, stream.id, true);

    // Check if we should disable the stream
    const recentFailures = await countRecentFailures(stream.id, FAILURE_WINDOW_MINUTES);

    if (recentFailures >= MAX_CONSECUTIVE_FAILURES) {
      await disableStreamOnFailure(stream.id, result.error || "Too many delivery failures");
    }

    logger.warn("Webhook delivery failed", {
      streamId: stream.id,
      blockHeight: block.height,
      error: result.error,
      recentFailures,
    });
  }

  return { stream, block, matches, payload, delivered: result.success };
}

/**
 * Disable a stream due to repeated delivery failures
 */
async function disableStreamOnFailure(streamId: string, error: string): Promise<void> {
  const db = getDb();

  await db
    .updateTable("streams")
    .set({
      status: "failed",
      updated_at: new Date(),
    })
    .where("id", "=", streamId)
    .execute();

  await updateStreamMetrics(db, streamId, { errorMessage: error });

  logger.error("Stream disabled due to delivery failures", {
    streamId,
    error,
  });
}
