import { sql, type Kysely } from "kysely";
import type { Database } from "../types.ts";

export async function getStreamMetrics(db: Kysely<Database>, streamId: string) {
  return (
    await db
      .selectFrom("stream_metrics")
      .selectAll()
      .where("stream_id", "=", streamId)
      .executeTakeFirst()
  ) ?? null;
}

export async function updateStreamMetrics(
  db: Kysely<Database>,
  streamId: string,
  updates: Partial<{
    lastTriggeredAt: Date;
    lastTriggeredBlock: number;
    totalDeliveries: number;
    failedDeliveries: number;
    errorMessage: string | null;
  }>,
) {
  await db
    .insertInto("stream_metrics")
    .values({
      stream_id: streamId,
      last_triggered_at: updates.lastTriggeredAt ?? null,
      last_triggered_block: updates.lastTriggeredBlock ?? null,
      total_deliveries: updates.totalDeliveries ?? 0,
      failed_deliveries: updates.failedDeliveries ?? 0,
      error_message: updates.errorMessage ?? null,
    })
    .onConflict((oc) =>
      oc.column("stream_id").doUpdateSet({
        ...(updates.lastTriggeredAt !== undefined ? { last_triggered_at: updates.lastTriggeredAt } : {}),
        ...(updates.lastTriggeredBlock !== undefined ? { last_triggered_block: updates.lastTriggeredBlock } : {}),
        ...(updates.totalDeliveries !== undefined ? { total_deliveries: updates.totalDeliveries } : {}),
        ...(updates.failedDeliveries !== undefined ? { failed_deliveries: updates.failedDeliveries } : {}),
        ...(updates.errorMessage !== undefined ? { error_message: updates.errorMessage } : {}),
      }),
    )
    .execute();
}

export async function incrementDeliveryCount(
  db: Kysely<Database>,
  streamId: string,
  failed: boolean,
) {
  await db
    .insertInto("stream_metrics")
    .values({
      stream_id: streamId,
      total_deliveries: 1,
      failed_deliveries: failed ? 1 : 0,
    })
    .onConflict((oc) =>
      oc.column("stream_id").doUpdateSet({
        total_deliveries: sql`stream_metrics.total_deliveries + 1`,
        ...(failed ? { failed_deliveries: sql`stream_metrics.failed_deliveries + 1` } : {}),
      }),
    )
    .execute();
}
