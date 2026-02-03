import { sql } from "kysely";
import { getDb } from "../db/index.ts";
import type { Job } from "../db/types.ts";
import { randomUUID } from "crypto";

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

// Worker identifier for this process
const WORKER_ID = `worker-${randomUUID().slice(0, 8)}`;

/**
 * Enqueue a new job for stream evaluation
 */
export async function enqueue(
  streamId: string,
  blockHeight: number,
  backfill = false
): Promise<string> {
  const db = getDb();

  const row = await db
    .insertInto("jobs")
    .values({
      stream_id: streamId,
      block_height: blockHeight,
      backfill,
      status: "pending",
      attempts: 0,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  return row.id;
}

/**
 * Claim a pending job using SKIP LOCKED to prevent concurrent access
 * Returns null if no jobs available
 */
export async function claim(): Promise<Job | null> {
  const db = getDb();

  const { rows } = await sql<Job>`
    UPDATE jobs
    SET
      status = 'processing',
      locked_at = NOW(),
      locked_by = ${WORKER_ID},
      attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending'
      ORDER BY
        backfill ASC,
        block_height ASC,
        created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `.execute(db);

  return rows[0] ?? null;
}

/**
 * Mark a job as completed
 */
export async function complete(jobId: string): Promise<void> {
  const db = getDb();

  await db
    .updateTable("jobs")
    .set({
      status: "completed",
      completed_at: new Date(),
      locked_at: null,
      locked_by: null,
    })
    .where("id", "=", jobId)
    .execute();
}

/**
 * Mark a job as failed
 * Re-queues if under max attempts, otherwise marks as permanently failed
 */
export async function fail(
  jobId: string,
  error: string,
  maxAttempts = 3
): Promise<void> {
  const db = getDb();

  const job = await db
    .selectFrom("jobs")
    .select("attempts")
    .where("id", "=", jobId)
    .executeTakeFirst();

  if (!job) return;

  if (job.attempts < maxAttempts) {
    await db
      .updateTable("jobs")
      .set({
        status: "pending",
        error,
        locked_at: null,
        locked_by: null,
      })
      .where("id", "=", jobId)
      .execute();
  } else {
    await db
      .updateTable("jobs")
      .set({
        status: "failed",
        error,
        completed_at: new Date(),
        locked_at: null,
        locked_by: null,
      })
      .where("id", "=", jobId)
      .execute();
  }
}

/**
 * Get queue statistics
 */
export async function stats(): Promise<QueueStats> {
  const { rows } = await sql<{ status: string; count: string }>`
    SELECT status, COUNT(*) as count
    FROM jobs
    GROUP BY status
  `.execute(getDb());

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = parseInt(row.count, 10);
  }

  return {
    pending: counts["pending"] || 0,
    processing: counts["processing"] || 0,
    completed: counts["completed"] || 0,
    failed: counts["failed"] || 0,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

/**
 * Get worker ID for this process
 */
export function getWorkerId(): string {
  return WORKER_ID;
}

export { WORKER_ID };
