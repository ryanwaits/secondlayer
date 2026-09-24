---
"@secondlayer/api": minor
---

Remove the duplicate `GET /api/subgraphs/:name/:table/stream` and `GET /api/subgraphs/:name/:table/:id` routes. Use the same paths under `/v1/subgraphs`, which the SDK already calls.
