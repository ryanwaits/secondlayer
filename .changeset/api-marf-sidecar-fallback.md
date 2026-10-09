---
"@secondlayer/api": patch
---

`/v1/proofs/marf` proves keys the node 404s, such as `__MARF_BLOCK_HEIGHT_TO_HASH::<height>`, through the proof sidecar's `/marf` route when `PROOF_SIDECAR_URL` is set: same `{data, proof}` shape and proof encoding, `data` the raw 40-byte leaf value. Without a sidecar those keys stay 404.
