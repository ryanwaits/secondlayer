---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": patch
---

Bitcoin txids match in any form. The `sbtc_deposit` `bitcoinTxid` and withdrawal `sweepTxid` trigger fields accept bare explorer hex or `0x`-prefixed hex in any case and normalize to the stored `0x` + lowercase form; a value that isn't a 32-byte hex txid is rejected instead of silently never matching. Triggers saved before this still match. New `normalizeBtcTxid` helper. Docs no longer promise `*` wildcards on sBTC and Runes fields, which always matched exactly.
