---
"@secondlayer/mcp": patch
"@secondlayer/cli": patch
---

Stop telling agents Index reads need Build+ or live on a "layer."

Index `/v1` reads are keyless. Free-tier keys are accepted at the free rate.
MCP tool descriptions and `secondlayer index --help` now say that instead of
pointing at a paid plan that does not exist.
