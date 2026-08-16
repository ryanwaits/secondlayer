---
"@secondlayer/cli": minor
---

`secondlayer bootstrap` and `secondlayer repair` now quote and meter partition fetches against the official hosted archive (`archive.secondlayer.tools`): a free price preview prints into the existing plan output, the operator confirms (or passes `-y`, which skips only the prompt, never the quote or the balance check), and only then are partitions fetched through short-lived presigned URLs. Fetching from any other manifest, a mirror, a teammate's box, a local file, stays free and never contacts a Secondlayer server. `secondlayer verify` is unaffected; it never touches partition bytes.
