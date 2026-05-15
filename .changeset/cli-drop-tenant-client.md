---
"@secondlayer/cli": minor
---

Drop tenant client routing. All API calls now go to the platform base URL with the session token directly — no more ephemeral JWT mint, no more per-tenant URLs. Subgraph and subscription commands hit `api.secondlayer.tools` like every other command.
