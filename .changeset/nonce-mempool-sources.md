---
"@secondlayer/stacks": minor
---

Add mempool-aware nonce sources and silent-drop reconciliation.

The default `jsonRpcSource` reads only the confirmed nonce; these additions fold pending (mempool) txs into the next-nonce computation and self-heal silently-dropped txs. The gap-filling core is generic and the pending source is pluggable — you are never locked to any one provider.

- `mempoolAwareSource({ getPending, getConfirmed? })` — gap-filling core; bring your own pending-nonce fetch. Returns the lowest free nonce ≥ confirmed (fills gaps, unlike `possible_next_nonce` which strands them). Degrades to the confirmed floor if `getPending` fails.
- `indexSource({ baseUrl?, apiKey? })` — prebuilt over Secondlayer's `/v1/index/mempool` (configurable `baseUrl`, keyless by default). Note: our mempool is a go-forward single-node observed view.
- `hiroNonceSource({ baseUrl })` — off-the-shelf, non-Secondlayer source over Hiro's `/extended/v1/address/{address}/nonces`; fills the lowest detected gap first.
- `reconcileNonce(manager, { client, address, source })` + `startNonceReconciler(...)` — periodically reconcile a tracked nonce against an authoritative source, healing drift that produces no broadcast error (dropped/GC'd mempool tx, or chain advancing past the local view). Single-writer: run the reconciler in one process. Adds `peek` to `NonceManager`/`NonceStore`.
- `nextFreeNonce(confirmed, pending)` exported for direct use.

The defaults remain node-agnostic with zero Secondlayer dependency; all mempool-awareness is opt-in.
