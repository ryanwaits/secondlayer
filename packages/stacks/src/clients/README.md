# Clients

Client factories and composable action decorators.

## Public Client (Read-Only)

```typescript
import { createPublicClient, http, mainnet } from "@secondlayer/stacks";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const balance = await client.getBalance({ address: "SP2J6..." });
const height = await client.getBlockHeight();
```

## Wallet Client

```typescript
import { createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";

const client = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: mainnet,
  transport: http(),
});

const { txid } = await client.sendTransaction({ transaction: signedTx });
```

## Multi-Sig Client

```typescript
import { createMultiSigClient, http, mainnet } from "@secondlayer/stacks";

const client = createMultiSigClient({
  publicKeys: [pk1, pk2, pk3],
  signaturesRequired: 2,
  chain: mainnet,
  transport: http(),
});
```

## Extending with Extensions

```typescript
import { bns } from "@secondlayer/stacks/bns";
import { pox } from "@secondlayer/stacks/pox";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
}).extend(bns()).extend(pox());

await client.bns.resolveName("alice.btc");
await client.pox.getPoxInfo();
```

## Custom Decorators

```typescript
const myActions = (client) => ({
  myCustomAction: () => client.readContract({ ... }),
});

const client = createPublicClient({ ... }).extend(myActions);
```
