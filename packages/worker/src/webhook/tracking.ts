import { getDb, jsonb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import type { Delivery } from "@secondlayer/shared/db";
import type { WebhookPayload } from "./payload.ts";
import type { DispatchResult } from "./dispatcher.ts";

export interface DeliveryRecord {
  streamId: string;
  jobId: string | null;
  blockHeight: number;
  result: DispatchResult;
  payload: WebhookPayload;
}

/**
 * Record a delivery attempt in the database
 */
export async function recordDelivery(record: DeliveryRecord): Promise<string> {
  const db = getDb();

  const row = await db
    .insertInto("deliveries")
    .values({
      stream_id: record.streamId,
      job_id: record.jobId,
      block_height: record.blockHeight,
      status: record.result.success ? "success" : "failed",
      status_code: record.result.statusCode ?? null,
      response_time_ms: record.result.responseTimeMs,
      attempts: record.result.attempts,
      error: record.result.error ?? null,
      payload: jsonb(record.payload) as any,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return row.id;
}

/**
 * Get recent deliveries for a stream
 */
export async function getDeliveries(
  streamId: string,
  limit = 50
): Promise<Delivery[]> {
  return getDb()
    .selectFrom("deliveries")
    .selectAll()
    .where("stream_id", "=", streamId)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
}

/**
 * Get a specific delivery by ID
 */
export async function getDeliveryById(id: string): Promise<Delivery | null> {
  return (
    await getDb()
      .selectFrom("deliveries")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()
  ) ?? null;
}

/**
 * Count recent failed deliveries for a stream
 */
export async function countRecentFailures(
  streamId: string,
  windowMinutes = 60
): Promise<number> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);

  const result = await getDb()
    .selectFrom("deliveries")
    .select(sql<number>`count(*)`.as("count"))
    .where("stream_id", "=", streamId)
    .where("status", "=", "failed")
    .where("created_at", ">=", cutoff)
    .executeTakeFirst();

  return result?.count ?? 0;
}
