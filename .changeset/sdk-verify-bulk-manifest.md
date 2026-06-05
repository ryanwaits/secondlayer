---
"@secondlayer/sdk": minor
---

Add opt-in verification of the bulk dumps manifest signature. `createStreamsClient({ verifyDumpsManifest: true })` makes `client.dumps.list()` check the manifest's ed25519 signature against the published Streams key before any file sha256 is trusted — a sha256 is only as trustworthy as the manifest that carries it. It reuses the same key source as the live-response `verify` option (pinned PEM or `/public/streams/signing-key`). Defaults off so existing consumers are unaffected until historical manifests have been backfilled with signatures; an unsigned or tampered manifest throws `StreamsSignatureError` when enabled.
