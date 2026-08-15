---
"@secondlayer/sdk": major
"@secondlayer/stacks": major
"@secondlayer/shared": major
"@secondlayer/mcp": major
"@secondlayer/cli": major
---

Remove the x402 pay-per-call rail.

**Breaking.** These published entry points are gone:

- `@secondlayer/sdk` — the `x402` root exports (`withX402`, `createX402Client`, `payAndRetry`, `buildSignedX402Payment`, `readX402Challenge`, `readX402Receipt`, `selectOffer`, `resolveAccountNonce`, `X402SpendGuardError`, `DEFAULT_PREFER_ASSETS`, and their types) and the `@secondlayer/sdk/x402` subpath
- `@secondlayer/stacks` — the `@secondlayer/stacks/x402` subpath
- `@secondlayer/shared` — the `@secondlayer/shared/x402` subpath
- `@secondlayer/mcp` — `X402_PRIVATE_KEY` autopay and the `payPerCall` block in `secondlayer://context`
- REST — `/v1/x402/*`, `/x402/*`, `/.well-known/x402`, and the x402-paid `POST /v1/subgraphs` + `/v1/subgraphs/{name}/renew` writes, plus the `x-x402` OpenAPI extension

Also removed with it: wallet-ghost accounts and the 7-day paid-deploy TTL.
The rail was never a Secondlayer revenue line, and in practice it shipped a
hardcoded USD price catalog with no operator override — the opposite of the
"the operator is the merchant" intent.

`@secondlayer/cli` majors for the retired `subgraphs create --template` flag
and its five starter templates; `create` now emits a single inline starter, and
`--from-contract` remains the recommended path.
