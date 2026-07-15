---
"@secondlayer/stacks": minor
---

Bitcoin address derivation + network-aware sBTC signers address.

- `mnemonicToBitcoinKeys(mnemonic, { type: 'p2wpkh' | 'p2tr', network?, accountIndex?, changeIndex?, addressIndex? })` derives the paired BTC account from the same mnemonic as your Stacks account — BIP84 (`bc1q…`) and BIP86 (`bc1p…`) paths, validated against the official test vectors. Pure derivation, zero new dependencies.
- New `@secondlayer/stacks/bitcoin` helpers: `publicKeyToP2wpkhAddress`, `publicKeyToP2trAddress`, and `taprootTweakPubkey` (BIP341 key-path tweak). `BitcoinNetwork` gains `'regtest'` (`bcrt` hrp + testnet version bytes).
- sBTC extension: `client.sbtc.getSignersPublicKey()` reads the current signer-set aggregate key from `sbtc-registry`; `client.sbtc.getSignersAddress()` derives the signers' taproot deposit address, network-aware from `client.chain` (mainnet `bc1p…`, testnet `tb1p…`, devnet `bcrt1p…`) — verified against the live mainnet signers wallet.
- `formatBtcAddress` accepts an optional `network` param (default mainnet, back-compat) for testnet/regtest withdrawal-event decoding.
