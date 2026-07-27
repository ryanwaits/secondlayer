---
"@secondlayer/shared": patch
---

Type the `up`/`down` signatures in migrations `0082`, `0083`, and `0107` as `Kysely<any>`, matching Kysely's own `Migration` interface. `Kysely<unknown>` is a degenerate instantiation — `keyof unknown` is `never` — so a typed `Kysely<Database>` could never be passed to them. No DDL or runtime behavior changed.
