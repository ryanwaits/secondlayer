# @secondlayer/bitcoin

## 0.0.1

### Patch Changes

- 266a837: `GET /v1/bitcoin/outspend/{txid}/{vout}` says whether a Bitcoin output is spent, by which transaction and input, and whether the spend is in a block or still in the mempool. It reads the instance's Bitcoin node live (Bitcoin Core 24 or later, `txindex=1`). A confirmed spender is found by reading raw blocks back from the tip, up to 144; a deeper spend answers `spent: true` with a null spender and a `note`. Hosted: keyed, one row per answer, 20 requests per second per key. `@secondlayer/bitcoin` exports its raw block parser as `./block`.
