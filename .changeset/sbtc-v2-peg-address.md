---
"@secondlayer/stacks": minor
---

`getSignersAddress` returns the sBTC peg format active at the Bitcoin height: v1 `p2tr(aggregate pubkey)` below 972,295 and the v2 `tr(NUMS_V2, multi_a(threshold, signer/0/0, …))` from the registry signer set at and above it. With no options it reads the node's burn tip; pass `{ version }`, `{ burnBlockHeight }` or, off mainnet, `{ v2ActivationBurnHeight }`. A registry aggregate key must start with `0x02`/`0x03`: the v2 marker `0xFF || block hash` throws `SbtcV2MarkerError` from `getSignersPublicKey`, and `publicKeyToP2trAddress` rejects any other 33-byte prefix. New: `getSignerSet`, `deriveSbtcV2PegOutput`, `deriveSbtcSigningKey`, `assertRegistryAggregateKey`, `SBTC_V2_SIGNING_BURN_HEIGHT_MAINNET`, `SBTC_V2_INTERNAL_KEY`; `taprootTweakPubkey` takes an optional merkle root. Off mainnet, `getSignersAddress()` with no options now throws until you pass `version` or `v2ActivationBurnHeight`.
