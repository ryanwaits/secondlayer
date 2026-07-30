---
"@secondlayer/cli": patch
---

`sl subgraphs deploy` now confirms destructive deploys BEFORE sending the request. The prompt previously fired after the server had already dropped and rebuilt the schema, so answering "n" aborted the CLI but the data was already gone. The CLI preflights the same schema diff the server runs and prompts on breaking changes or a startBlock change.
