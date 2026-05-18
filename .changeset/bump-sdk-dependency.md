---
"@secondlayer/cli": patch
"@secondlayer/mcp": patch
---

chore(deps): bump @secondlayer/sdk to v4

Pulls in the fix to `verifyWebhookSignature` (now validates the real Standard Webhooks delivery headers). Neither package calls `verifyWebhookSignature` directly, so no consumer-facing behavior changes here.
