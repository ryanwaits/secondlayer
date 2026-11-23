---
"@secondlayer/cli": minor
---

Add `keys create [--name <name>]` and `keys revoke <ref>`. `create` prints the new secret once. `revoke` asks first (`-y` skips; a non-TTY without `-y` exits 1) and warns when the key was your CLI login or `SECONDLAYER_API_KEY`.
