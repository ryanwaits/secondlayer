---
"@secondlayer/shared": patch
---

Index webhook_deliveries.outbox_id and delete a webhook's deliveries and outbox in batches, so removing a high-volume chain webhook finishes instead of holding a lock until the API idle timeout returns 502.
