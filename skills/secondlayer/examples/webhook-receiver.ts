// Standard Webhooks receiver in Hono.
//
// Uses @secondlayer/sdk's verifyWebhookSignature, which reads the
// `webhook-id` / `webhook-timestamp` / `webhook-signature` headers, checks
// the timestamp is within tolerance, and HMAC-verifies a `v1` signature.
//
// Set SIGNING_SECRET to the value returned ONCE by `sl create subscription`
// or `sl subscriptions rotate-secret`.

import { Hono } from "hono";
import { verifyWebhookSignature } from "@secondlayer/sdk";

const app = new Hono();

app.post("/webhook", async (c) => {
  // Raw body — must NOT be re-stringified after JSON parsing.
  const raw = await c.req.text();

  if (!verifyWebhookSignature(raw, c.req.raw.headers, process.env.SIGNING_SECRET!)) {
    return c.text("invalid signature", 401);
  }

  const payload = JSON.parse(raw) as {
    type: string;                      // "<subgraph>.<table>.created"
    timestamp: string;                 // ISO 8601 at dispatch time
    data: Record<string, unknown>;     // the row
  };

  // Dedup on `webhook-id` if your handler isn't idempotent — the same id
  // arrives on every retry.
  const deliveryId = c.req.header("webhook-id");
  console.log(`[${payload.type}] delivery=${deliveryId}`, payload.data);

  // Return 2xx fast. Long work goes on a queue — Secondlayer retries on
  // 5xx / timeout with backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h.
  return c.json({ ok: true });
});

export default {
  port: 3000,
  fetch: app.fetch,
};
