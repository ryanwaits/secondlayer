import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDb } from "@secondlayer/shared/db";
import { assertStreamOwnership, getAccountId, getAccountKeyIds } from "../lib/ownership.ts";

const app = new Hono();

// SSE stream for real-time delivery logs
app.get("/:id/stream", async (c) => {
  const { id } = c.req.param();
  const db = getDb();
  const accountId = getAccountId(c);
  const keyIds = accountId ? await getAccountKeyIds(db, accountId) : undefined;

  // Check stream exists and ownership
  await assertStreamOwnership(db, id, keyIds);

  return streamSSE(c, async (sseStream) => {
    let lastDeliveryId: string | null = null;
    let running = true;

    // Poll for new deliveries (in production, use pg_notify)
    while (running) {
      try {
        const results = await db
          .selectFrom("deliveries")
          .selectAll()
          .where("stream_id", "=", id)
          .orderBy("created_at", "desc")
          .limit(10)
          .execute();

        // Find new deliveries
        for (const delivery of results.reverse()) {
          if (!lastDeliveryId || delivery.id > lastDeliveryId) {
            await sseStream.writeSSE({
              event: "delivery",
              data: JSON.stringify({
                id: delivery.id,
                blockHeight: delivery.block_height,
                status: delivery.status,
                statusCode: delivery.status_code,
                responseTimeMs: delivery.response_time_ms,
                attempts: delivery.attempts,
                error: delivery.error,
                createdAt: delivery.created_at.toISOString(),
              }),
            });
            lastDeliveryId = delivery.id;
          }
        }

        // Send heartbeat
        await sseStream.writeSSE({
          event: "heartbeat",
          data: new Date().toISOString(),
        });

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (_err) {
        // Connection closed or error
        running = false;
      }
    }
  });
});

export default app;
