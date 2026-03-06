# Actions

Standalone action functions for tree-shakeable imports. These are the same functions available on clients, but usable without a client instance.

## Public (Read-Only) Actions

```typescript
import { getBalance, getNonce, readContract, getBlock } from "@secondlayer/stacks/actions";

const balance = await getBalance(client, { address: "SP2J6..." });
const nonce = await getNonce(client, { address: "SP2J6..." });
const height = await getBlockHeight(client);
```

## Contract Reads

```typescript
import { readContract } from "@secondlayer/stacks/actions";
import { Cl } from "@secondlayer/stacks/clarity";

const result = await readContract(client, {
  contractAddress: "SP2J6...",
  contractName: "my-contract",
  functionName: "get-balance",
  functionArgs: [Cl.principal("SP3FBR...")],
});
```

## Typed Contracts

```typescript
import { getContract } from "@secondlayer/stacks/actions";

const contract = getContract({
  client,
  address: "SP2J6...",
  name: "my-contract",
  abi: MY_ABI,
});

// Type-safe reads and calls
const balance = await contract.read.getBalance({ account: "SP3FBR..." });
const txid = await contract.call.transfer({ to: "SP3FBR...", amount: 100n });
```

## Wallet Actions

```typescript
import { sendTransaction, transferStx, callContract } from "@secondlayer/stacks/actions";

const { txid } = await sendTransaction(client, { transaction: signedTx });

const txid = await transferStx(client, {
  recipient: "SP2J6...",
  amount: 1_000_000n,
});
```

## Simulation

```typescript
import { simulateCall, multicall } from "@secondlayer/stacks/actions";

// Dry-run a contract call
const result = await simulateCall(client, {
  contractAddress: "SP2J6...",
  contractName: "my-contract",
  functionName: "transfer",
  functionArgs: [Cl.uint(100)],
  sender: "SP3FBR...",
});

// Batch multiple reads
const results = await multicall(client, {
  calls: [
    { contractAddress: "SP2J6...", contractName: "token-a", functionName: "get-balance", functionArgs: [Cl.principal("SP3FBR...")] },
    { contractAddress: "SP2J6...", contractName: "token-b", functionName: "get-balance", functionArgs: [Cl.principal("SP3FBR...")] },
  ],
});
```
