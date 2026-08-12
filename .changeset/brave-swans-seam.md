---
"@secondlayer/cli": patch
---

`sl bootstrap` now records where the indexer should resume and reports how far
the chain moved while restoring. A restored instance previously held its full
history while reporting no progress at all, because nothing wrote the resume
point and the indexer's own recompute could not create it.
