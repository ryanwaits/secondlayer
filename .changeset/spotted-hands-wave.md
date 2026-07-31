---
"@secondlayer/sdk": minor
"@secondlayer/mcp": patch
---

`index.ftTransfers` accepts `assetIdentifier`, matching `nftTransfers` — and the Index API now accepts `asset_identifier` on every ft event read (`ft_transfer`, `ft_mint`, `ft_burn`). This closes a vocabulary drift the unified filter union exposed within a day of shipping: `on.ftTransfer({ assetIdentifier }).toIndexParams()` produced a query the server refused with a 400, because the union projects the field for all six token event types while the server's allowlist covered only the nft three. The column is NOT NULL for every ft row; the rejection was the bug.

Server fixes riding along, found by dogfooding the quickstart: `pox5/events`, `sbtc/deposits`, and `transactions` computed pagination cursors or reorg spans from field-projected rows — omitting `event_index`/`tx_index` from `fields` caused a 500 or a corrupt `next_cursor`. All three now derive them from raw rows, per the rule the other resources already followed. Same class, worse symptom, on `/v1/subgraphs/<name>/<table>`: `_fields` without `_id` returned a full page with `next_cursor: null`, silently truncating the result set — `_id` now always drives the cursor server-side and is stripped from rows only when unrequested.

MCP: the `subgraphs_query` tail guidance now says to include `_id` in `fields` when polling forward, since the next poll filter cannot be formed without it.
