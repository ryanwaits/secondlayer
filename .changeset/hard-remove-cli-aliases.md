---
"@secondlayer/cli": major
---

Remove every deprecated command alias. There is no shim — the old spellings error out, and each capability now has exactly one door.

- `subgraphs cancel` → `subgraphs stop`
- `streams pull` → `streams dumps`
- `subgraphs codegen` → `codegen subgraph` (or `codegen prints` for `--payloads`)
- `subgraphs client` → `codegen client`
- `index codegen` → `codegen index`
- `contracts generate` / `contracts gen` → `codegen contracts` (the `contracts` group held nothing else, so it is gone too)

`codegen subgraph` defaults `--target` to `kysely`, the same default every other codegen surface uses — the retired `subgraphs codegen` alias kept `prisma`, so scripts that relied on the implicit default must now pass `--target prisma`.
