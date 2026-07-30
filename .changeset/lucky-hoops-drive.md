---
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": patch
---

Field projection now covers sBTC withdrawals, transactions, and pox-5 events alongside deposits and index events. Each narrows its row type to the requested columns, so reading an unrequested one is a compile error.

Which columns always survive differs per resource, deliberately: a withdrawal is keyed by `request_id` and carries no `block_height` at all, a transaction keeps `tx_id`, and a pox-5 event keeps `topic` because it is the row's discriminant. Dropping those would leave a row that cannot be paginated or identified rather than a smaller one.

Not projected: `blocks`, `ft_transfers`, and `nft_transfers` — those rows are 5-8 columns wide and projection would cost more in API surface than it saves on the wire.

Subgraphs: `contractId` and `trait` compose — the matcher ANDs them, so the pair means "contracts conforming to this trait, narrowed to these ids". A doc comment claimed they were mutually exclusive, which contradicted both the validator and the runtime.

A chain read that cannot be pinned to a block now logs a warning. It is reachable only under `cache: "contract-constant"` on a block with no persisted `index_block_hash` — allowed, since that mode asserts the value cannot change, but no longer silent.
