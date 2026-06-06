---
"@secondlayer/sdk": minor
---

Verify the bulk dumps manifest signature by default. `createStreamsClient` now defaults `verifyDumpsManifest` to `true`, so `client.dumps.list()` (and `events.replay()`, which hydrates from dumps) checks the manifest's ed25519 signature against the published Streams key before trusting any file sha256 — closing the gap where a tampered manifest+file pair verified cleanly. All published manifests are now signed, so this is transparent for consumers pointing at Secondlayer; pass `verifyDumpsManifest: false` to opt out. A missing or invalid signature throws `StreamsSignatureError`.
