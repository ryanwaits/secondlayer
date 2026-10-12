---
"@secondlayer/sdk": patch
"@secondlayer/cli": patch
---

Subgraph table reads return `next_cursor` on every page that has rows, `null` only when empty; tail with `cursor = next_cursor ?? cursor`. `secondlayer verify subgraph --replay` stops paging on a short page.
