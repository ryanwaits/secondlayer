# Post-Conditions

Fluent builder for Stacks post-conditions. Protects users by asserting expected asset transfers.

## STX

```typescript
import { Pc } from "@secondlayer/stacks/postconditions";

// Sender will send exactly 1 STX
Pc.principal("SP2J6...").willSendEq(1_000_000).ustx();

// Sender will send at most 5 STX
Pc.principal("SP2J6...").willSendLte(5_000_000).ustx();
```

## Fungible Tokens

```typescript
// Sender will send exactly 100 tokens
Pc.principal("SP2J6...")
  .willSendEq(100)
  .ft("SP2J6....my-token", "my-token");
```

## NFTs

```typescript
import { Cl } from "@secondlayer/stacks/clarity";

// Sender will send NFT
Pc.principal("SP2J6...")
  .willSendAsset()
  .nft("SP2J6....my-nft::my-nft", Cl.uint(1));

// Sender will NOT send NFT
Pc.principal("SP2J6...")
  .willNotSendAsset()
  .nft("SP2J6....my-nft::my-nft", Cl.uint(1));
```

## Comparators

| Method | Clarity Equivalent |
|---|---|
| `willSendEq(n)` | `=` |
| `willSendGt(n)` | `>` |
| `willSendGte(n)` | `>=` |
| `willSendLt(n)` | `<` |
| `willSendLte(n)` | `<=` |
