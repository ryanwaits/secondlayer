---
"@secondlayer/cli": minor
---

Move the sBTC faucet under `sl devnet faucet`. It reads your Clarinet project's
`Devnet.toml` and signs as that deployer, so it belongs with the other devnet
commands — and a top-level `sl faucet` implied it could serve testnet, which it
cannot.
