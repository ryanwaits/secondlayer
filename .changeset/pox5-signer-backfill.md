---
"@secondlayer/shared": patch
---

Backfills `signer` from `signer_manager` on existing `pox5_events` rows for `claim-rewards`, `claim-staker-rewards-for-signer`, `grant-signer-key`, and `revoke-signer-grant` — the four topics the decoder only just learned to derive `signer` for. Runs on hosted and self-host alike.
