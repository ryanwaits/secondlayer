---
"@secondlayer/api": patch
---

Fix subgraph redeploy silently dropping schema/handler changes. Bun's import() ignores ?query cache-busting for file URLs, so reusing a per-name handler file re-ran a stale cached module on every redeploy. Each deploy now writes a unique handler filename (and prunes prior ones) so the definition is always loaded fresh.
