---
"@secondlayer/cli": patch
---

`sl project create` no longer auto-writes `./.secondlayer/project`. If no global default project is set, the new project becomes the default in `~/.secondlayer/config.json`; otherwise it prints a `sl project use <slug>` hint. `sl project use` now also suggests gitignoring `.secondlayer/`.
