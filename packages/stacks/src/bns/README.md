# BNS v2

BNS (Bitcoin Name System) v2 extension for name resolution, registration, and management on Stacks.

## Setup

```typescript
import { createPublicClient, createWalletClient, http, mainnet } from "@secondlayer/stacks";
import { privateKeyToAccount } from "@secondlayer/stacks/accounts";
import { bns } from "@secondlayer/stacks/bns";

// Read-only client
const client = createPublicClient({
  chain: mainnet,
  transport: http(),
}).extend(bns());

// Wallet client (for registration/transfers)
const wallet = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: mainnet,
  transport: http(),
}).extend(bns());
```

## Resolve Names

```typescript
// Name -> address
const owner = await client.bns.resolveName("alice.btc");

// Address -> primary name
const name = await client.bns.getPrimaryName("SP2J6...");

// Check availability
const available = await client.bns.canRegister("bob.btc");

// Get price (microSTX)
const price = await client.bns.getNamePrice("bob.btc");

// Get NFT token ID
const id = await client.bns.getNameId("alice.btc");
```

## Register Names

Two registration paths:

### Fast Claim (instant, snipeable)

```typescript
const txid = await wallet.bns.claimFast({
  name: "bob.btc",
  recipient: account.address,
});
```

### Secure Registration (2-step, front-run proof)

```typescript
// Step 1: Preorder (commits salted hash)
const { txid, salt } = await wallet.bns.preorder({ name: "bob.btc" });

// Wait ~10 minutes (1 Bitcoin block)

// Step 2: Register (reveals name)
await wallet.bns.register({ name: "bob.btc", salt });
```

## Manage Names

```typescript
// Transfer
await wallet.bns.transfer({
  name: "alice.btc",
  recipient: "SP3FBR...",
});

// Set primary name
await wallet.bns.setPrimary({ name: "alice.btc" });
```

## Zonefiles

```typescript
// Read zonefile
const zonefile = await client.bns.getZonefile("alice.btc");
if (zonefile) console.log(new TextDecoder().decode(zonefile));

// Update zonefile
await wallet.bns.updateZonefile({
  name: "alice.btc",
  zonefile: "$ORIGIN alice.btc\n$TTL 3600\n...",
});

// Clear zonefile
await wallet.bns.revokeZonefile("alice.btc");
```

## Namespace

All methods accept fully-qualified names (`alice.btc`) or bare names (`alice`, defaults to `.btc`).
