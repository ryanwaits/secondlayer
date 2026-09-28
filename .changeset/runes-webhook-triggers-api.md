---
"@secondlayer/api": patch
---

Webhook creation normalizes a Runes trigger's `rune` field (an id or a name) to its canonical `rune_id` and rejects an unresolvable one with 400, when Bitcoin data is configured on this instance. Documents the new Runes trigger types and fields on the webhooks OpenAPI schema.
