---
"@secondlayer/subgraphs": patch
---

port the subgraph handler sandbox from the disproven Bun Worker substrate to a per-tenant OS subprocess, add a containment test suite proving the boundary, and wire dark dispatch behind sandboxEnabled() (nothing sets the flag; production behavior unchanged)
