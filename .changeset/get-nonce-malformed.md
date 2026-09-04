---
"@secondlayer/stacks": patch
---

`getNonce` percent-encodes the address and throws `MalformedResponseError` when `/v2/accounts` omits `nonce`, matching `getBalance` / `getAccountInfo`.
