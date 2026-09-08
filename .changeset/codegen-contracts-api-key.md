---
"@secondlayer/cli": patch
---

`codegen contracts` no longer redeclares global `--api-key` (Commander bound it to the ancestor, so a Hiro-looking key overwrote INSTANCE_TOKEN). ABI fetch already uses `resolveAuth()`. The missing-output path names `secondlayer codegen contracts … -o/--output`, not the unregistered `generate` verb.
