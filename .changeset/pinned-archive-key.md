---
"@secondlayer/cli": minor
---

`verify` and `repair` resolve the archive signing key the same way `bootstrap` does: `--public-key`, then `ARCHIVE_SIGNING_PUBLIC_KEY`, then (hosted mode only, over https) the key endpoint on api.secondlayer.tools, then the key built into the release. OSS mode never leaves the machine for a key. Plaintext `http://` key endpoints are never consulted. `latest.json` pointers must carry a snapshot digest, name a `snapshots/<sha256>.json` path, and verify their signature against the resolved key. Partition paths that leave the archive root are refused. `setup` and `init` always write `ARCHIVE_SIGNING_PUBLIC_KEY`.
