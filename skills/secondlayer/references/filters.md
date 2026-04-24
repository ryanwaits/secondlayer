# Event Filters

Subgraph sources use 13 filter types. Every filter has a required `type` and
optional narrowing fields.

Use filters inside named `sources`:

```typescript
sources: {
  transfer: { type: "stx_transfer", minAmount: 100000000n },
}
```

## STX

```typescript
{ type: "stx_transfer", sender: "SP...", recipient: "SP...", minAmount: 1000000n, maxAmount: 5000000n }
{ type: "stx_mint", recipient: "SP...", minAmount: 1000000n }
{ type: "stx_burn", sender: "SP...", minAmount: 1000000n }
{ type: "stx_lock", lockedAddress: "SP...", minAmount: 1000000n }
```

Amounts are microSTX.

## Fungible Tokens

```typescript
{ type: "ft_transfer", assetIdentifier: "SP123.token::token", sender: "SP...", recipient: "SP...", minAmount: 100n }
{ type: "ft_mint", assetIdentifier: "SP123.token::token", recipient: "SP...", minAmount: 100n }
{ type: "ft_burn", assetIdentifier: "SP123.token::token", sender: "SP...", minAmount: 100n }
```

## NFTs

```typescript
{ type: "nft_transfer", assetIdentifier: "SP123.collection::asset", sender: "SP...", recipient: "SP..." }
{ type: "nft_mint", assetIdentifier: "SP123.collection::asset", recipient: "SP..." }
{ type: "nft_burn", assetIdentifier: "SP123.collection::asset", sender: "SP..." }
```

## Contracts

```typescript
{ type: "contract_call", contractId: "SP123.marketplace", functionName: "buy", caller: "SP..." }
{ type: "contract_deploy", deployer: "SP...", contractName: "token-*" }
{ type: "print_event", contractId: "SP123.marketplace", topic: "sale" }
```

`contractId`, `functionName`, and `contractName` support wildcards such as
`"SP123.*"` and `"swap*"`.

## Patterns

Track whale STX transfers:

```typescript
{ type: "stx_transfer", minAmount: 100000000n }
```

Track a DEX contract:

```typescript
{
  swaps: { type: "print_event", contractId: "SP123.amm-pool", topic: "swap" },
  calls: { type: "contract_call", contractId: "SP123.amm-pool" },
}
```

Track NFT marketplace sales:

```typescript
{
  sale: { type: "print_event", contractId: "SP123.marketplace", topic: "sale" },
  nftMoves: { type: "nft_transfer", assetIdentifier: "SP123.collection::nft" },
}
```
