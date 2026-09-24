---
"@secondlayer/api": minor
"@secondlayer/shared": minor
"@secondlayer/cli": patch
---

Drop the subgraph `visibility` column (migration 0136) and the `visibility` and `owned` fields from subgraph list and detail responses. Nothing read them: publish is gone and self-host decides access by bind and instance token. Generated subgraph specs (`openapi.json`, `schema.json`, `docs.md`) always describe the `/v1/subgraphs` surface; `SubgraphSpecOptions.forcePublicRead` is removed.
