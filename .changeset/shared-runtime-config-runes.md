---
"@secondlayer/shared": patch
---

The runtime config accepts `BITCOIN_DATABASE_URL`, and allows `BITCOIN_RPC_PASSWORD` in every node mode so the Runes follower can read any Bitcoin node. The repo's compose file no longer crash-loops the runtime at boot.
