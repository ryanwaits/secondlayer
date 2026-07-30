---
"@secondlayer/cli": minor
"@secondlayer/scaffold": minor
---

One codegen verb, and scaffolds that emit typed handlers.

- **`sl codegen contracts | subgraph <file> | index | client <name> | prints <file>`** replaces six entry points under three verbs. Every subcommand takes `-o/--output`, and `--target` means the same thing with the same default (`kysely`) everywhere — previously `sl subgraphs codegen -o db.ts` wrote Prisma while the muscle-memory-identical `sl index codegen -o db.ts` wrote Kysely. The old paths keep working and print a deprecation notice; they retain their original defaults so existing scripts don't silently change output. They are removed in the next major.
- **Scaffolds emit the `as const` ABI and reference it from the source**, so handlers read named, typed arguments (`event.input.tokenId`) instead of positional `event.args[0] as bigint`. The MCP scaffold inlines it in its single text blob. Both paths normalize the ABI first — emitting a raw one verbatim produced an `as const` that silently failed the `AbiContract` constraint and degraded typing without a word.
- **Generated row types are aliases over the emitted schema** (`InferTableRow<typeof _schema…>`), not a second hand-written type map. The local map answered `uint` with `number` while the runtime client answered `bigint`: the generated interface did not compile against the client it shipped beside, and truncated `uint128` above 2^53. A new test pins that no generator maps `uint` to a JS `number`.
- **The print scaffold honors `always_present`**, emitting `{ type, optional: true }` for fields not seen on every sampled event — it used to drop the flag while `--payloads` honored it, so the same schema produced two different answers about optionality. Generated files are stamped with the sample size and block range, because `prints` is inferred, not guaranteed.
