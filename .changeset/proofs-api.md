---
"@secondlayer/api": minor
---

New `/v1/proofs/*`: state witnesses, consensus-hash preimages and Bitcoin headers from the proof sidecar (`PROOF_SIDECAR_URL`, 503 when unset), plus signed blocks and MARF inclusion proofs from the node. Bytes pass through unchanged. Free: never metered; hosted reads take any account key and are rate limited per account, witness in its own lower bucket.
