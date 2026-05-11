---
"@secondlayer/indexer": patch
---

fix nft decoder default to apply server-side types filter

`consumeNftTransferDecodedEvents` was passing `types: opts?.types` (undefined by default), so the streams query scanned every event type in the cursor range and timed out the API on big backlogs — leaving the NFT decoder stuck on its previous cursor. Now defaults to `["nft_transfer"]`, mirroring the FT decoder.
