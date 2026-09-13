# Connect

Browser wallet connection via SIP-030 (Leather, Xverse, etc.).

## Connect Wallet

```typescript
import { connect, disconnect, isConnected } from "@secondlayer/stacks/connect";

// Prompt user to connect
const { addresses } = await connect();
const stxAddress = addresses.find((a) => a.symbol === "STX");

// Check connection state
if (isConnected()) {
  // ...
}

// Disconnect
disconnect();
```

## Wallet Requests

```typescript
import { request } from "@secondlayer/stacks/connect";

// Transfer STX
await request("stx_transferStx", {
  recipient: "SP2J6...",
  amount: "1000000",
  memo: "coffee",
});

// Call contract
await request("stx_callContract", {
  contract: "SP2J6....my-contract",
  functionName: "transfer",
  functionArgs: [Cl.uint(100), Cl.principal("SP3FBR...")],
});

// Deploy contract
await request("stx_deployContract", {
  name: "my-token",
  clarityCode: "(define-fungible-token my-token)",
});

// Sign message
await request("stx_signMessage", {
  message: "Hello Stacks",
});
```

## Provider Detection

```typescript
import { isWalletInstalled, getProvider, setProvider } from "@secondlayer/stacks/connect";

if (isWalletInstalled()) {
  const provider = getProvider();
}

// Use a custom provider
setProvider(myCustomProvider);
```
