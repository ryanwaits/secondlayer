---
"@secondlayer/stacks": minor
---

`@secondlayer/stacks/bitcoin` exports `bitcoinRpcCall`, a Bitcoin Core JSON-RPC transport (Basic auth, optional timeout, typed `BitcoinRpcError` / `BitcoinRpcTransportError` whose messages never carry the node URL or credentials), and `bitcoinRpcConfigFromEnv`. `bitcoinRpcSource` uses it; its errors are unchanged except that a network failure no longer echoes the underlying fetch error text.
