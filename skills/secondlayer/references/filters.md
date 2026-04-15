# Event Filter Types

13 filter types, discriminated by `type` field. All fields besides `type` are optional.

## STX Transfers

```json
{ "type": "stx_transfer", "sender": "SP...", "recipient": "SP...", "minAmount": 1000000, "maxAmount": 5000000 }
```
Amounts in microSTX (1 STX = 1,000,000 microSTX).

## STX Mint

```json
{ "type": "stx_mint", "recipient": "SP...", "minAmount": 1000000 }
```

## STX Burn

```json
{ "type": "stx_burn", "sender": "SP...", "minAmount": 1000000 }
```

## STX Lock

```json
{ "type": "stx_lock", "lockedAddress": "SP...", "minAmount": 1000000 }
```

## Fungible Token Transfer

```json
{ "type": "ft_transfer", "sender": "SP...", "recipient": "SP...", "assetIdentifier": "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-wstx", "minAmount": 100 }
```

## Fungible Token Mint

```json
{ "type": "ft_mint", "recipient": "SP...", "assetIdentifier": "SP...::token", "minAmount": 100 }
```

## Fungible Token Burn

```json
{ "type": "ft_burn", "sender": "SP...", "assetIdentifier": "SP...::token", "minAmount": 100 }
```

## Non-Fungible Token Transfer

```json
{ "type": "nft_transfer", "sender": "SP...", "recipient": "SP...", "assetIdentifier": "SP...::nft-collection", "tokenId": "0x01000000000000000000000000000001" }
```
`tokenId` is the Clarity value encoded as hex.

## Non-Fungible Token Mint

```json
{ "type": "nft_mint", "recipient": "SP...", "assetIdentifier": "SP...::nft-collection", "tokenId": "0x..." }
```

## Non-Fungible Token Burn

```json
{ "type": "nft_burn", "sender": "SP...", "assetIdentifier": "SP...::nft-collection", "tokenId": "0x..." }
```

## Contract Call

```json
{ "type": "contract_call", "contractId": "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01", "functionName": "swap-helper", "caller": "SP..." }
```
`contractId` and `functionName` support wildcards: `"SP102*::amm-*"`, `"swap*"`.

## Contract Deploy

```json
{ "type": "contract_deploy", "deployer": "SP...", "contractName": "my-token*" }
```
`contractName` supports wildcards.

## Print Event (Smart Contract Events)

```json
{ "type": "print_event", "contractId": "SP...::marketplace", "topic": "listing-created", "contains": "nft" }
```
`contains` does substring search in event data.

## Common Patterns

**Track whale STX transfers (>100 STX)**:
```json
[{ "type": "stx_transfer", "minAmount": 100000000 }]
```

**Track all activity on a DEX contract**:
```json
[
  { "type": "contract_call", "contractId": "SP102...::amm-pool-v2-01" },
  { "type": "print_event", "contractId": "SP102...::amm-pool-v2-01" }
]
```

**Track NFT sales on a marketplace**:
```json
[
  { "type": "nft_transfer" },
  { "type": "print_event", "contractId": "SP...::marketplace", "topic": "sale" }
]
```

**Track new contract deployments**:
```json
[{ "type": "contract_deploy" }]
```
