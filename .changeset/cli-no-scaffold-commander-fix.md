---
"@secondlayer/cli": patch
---

`sl create subscription --no-scaffold` now actually skips the runtime template directory. The 5.4.8 implementation checked `opts.noScaffold`, but commander parses `--no-scaffold` as `opts.scaffold = false`, so the flag was a silent no-op (template was always copied). Now reads `opts.scaffold === false` at all four branch points.
