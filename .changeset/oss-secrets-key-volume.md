---
"@secondlayer/shared": patch
---

A self-hosted instance now keeps its generated secrets key under `DATA_DIR` instead of the container's working directory, moves a key it finds in `.env.local` there, and seals a canary into the instance row. A boot with a key that does not match refuses to start instead of silently orphaning webhook signing secrets.
