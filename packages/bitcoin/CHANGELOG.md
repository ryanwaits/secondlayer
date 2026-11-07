# @secondlayer/bitcoin

## 0.0.3

### Patch Changes

- a115638: Indexer state fixes. Observer journal receipts move through guarded transitions with `poisoned` and `skipped` states; one backlog query feeds `/health/integrity` and the applier. Failed contract ABI fetches retry with backoff up to five attempts (`contracts.abi_attempts`, `abi_next_attempt_at`). Fork repairs run the full reorg cascade under the apply lock, and reorgs lower `highest_seen_block`. `resolveChainTip` is the one chain-tip resolver, and `STACKS_NETWORK` is the one network variable (`NETWORK` still works, with a deprecation log). The archive pointer is promoted with a conditional write, late mempool announcements for confirmed transactions are ignored, and Runes batch backfill writes undo rows for its last blocks.

## 0.0.2

### Patch Changes

- f68684e: Remove unused tuning env vars in favor of fixed values, the no-op `verification` runtime module, the unreachable sBTC venue registry, finished one-time scripts, and the retired monthly tier values from the `api_keys.tier` type.

## 0.0.1

### Patch Changes

- 266a837: `GET /v1/bitcoin/outspend/{txid}/{vout}` says whether a Bitcoin output is spent, by which transaction and input, and whether the spend is in a block or still in the mempool. It reads the instance's Bitcoin node live (Bitcoin Core 24 or later, `txindex=1`). A confirmed spender is found by reading raw blocks back from the tip, up to 144; a deeper spend answers `spent: true` with a null spender and a `note`. Hosted: keyed, one row per answer, 20 requests per second per key. `@secondlayer/bitcoin` exports its raw block parser as `./block`.
