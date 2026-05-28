---
"@secondlayer/cli": minor
---

Disambiguate the code-generation commands so each verb means one output. The top-level `sl generate` (Clarity → TypeScript contract interfaces) drops its `codegen` alias (use `sl generate` or `sl gen`); `codegen` now refers only to `sl subgraphs codegen` (ORM schema). `sl subgraphs generate` (typed query client) is renamed to `sl subgraphs client` — `generate` still works as a deprecated alias.
