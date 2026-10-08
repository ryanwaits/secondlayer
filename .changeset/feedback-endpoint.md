---
"@secondlayer/api": minor
"@secondlayer/shared": patch
---

New hosted `POST /v1/feedback`: file a problem report with the `request_id` from an error body and one line of intent; the server attaches its record of the failed call. Idempotency-Key supported. Not mounted on self-hosted instances. Shared: `feedback_tickets` table (migration 0156).
