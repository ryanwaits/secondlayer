---
"@secondlayer/sdk": minor
"@secondlayer/api": minor
---

Index now serves decoded contract-call transactions. `GET /v1/index/contract-calls` returns each `contract_call` tx with its decoded `function_name`, positional `args` (Clarity values decoded to JSON), `result`, and `result_hex` — filterable by `contract_id`, `function_name`, and `sender`, cursor-paginated on `<block_height>:<tx_index>`. Sourced from the transactions table (canonical via block height); always returns `reorgs: []`.

SDK exports `decodeClarityValue` / `toJsonSafe` (a hex-Clarity-value → JSON-safe decoder, now shared by the print decoder and reusable by callers).
