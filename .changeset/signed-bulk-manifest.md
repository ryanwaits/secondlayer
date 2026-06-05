---
"@secondlayer/shared": minor
---

Sign the Streams cold-bulk parquet manifest with ed25519, closing the trust gap between the live and bulk availability lanes. The bulk manifest carried only per-file sha256, so a tampered manifest+file pair verified cleanly — the SDK threw a signature error on hash mismatch, overstating the guarantee. The exporter now signs each manifest with the platform Streams key (`STREAMS_SIGNING_PRIVATE_KEY`) over its canonical bytes (the manifest JSON minus the `signature`/`key_id` envelope), and a one-shot backfill script re-signs existing manifests in R2 (latest + history). New `@secondlayer/shared/streams-bulk-manifest` exports `signStreamsBulkManifest` / `verifyStreamsBulkManifestSignature` / `canonicalStreamsBulkManifestPayload`. Signing is a no-op when no key is set, and the `signature`/`key_id` fields are optional, so legacy unsigned manifests still parse — the SDK-side verification ships separately and stays default-off until the backfill has run.
