---
"@secondlayer/shared": major
"@secondlayer/sdk": major
---

Removes unused exports: the coverage receipt, sealer, runner, queue, repair and deep-verify helpers, and the runtime isolate, embedded-migration, upgrade and status helpers. Decoded row shapes no longer carry `source_cursor`, which always equalled `cursor`; read `cursor` instead.
