---
"@secondlayer/shared": patch
---

Migration 0140 adds a foreign key from `webhook_deliveries.webhook_id` to `webhooks(id)` with `ON DELETE CASCADE`. Deleting a webhook now deletes its delivery history instead of leaving it orphaned (1,186 orphaned rows had built up in the CI-mirror DB). Existing orphans are cleared before the constraint is added; the FK is added `NOT VALID` and validated separately to keep the lock short on a big table.
