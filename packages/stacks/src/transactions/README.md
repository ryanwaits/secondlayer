# Transactions

Build, sign, and serialize Stacks transactions (SIP-005).

## Token Transfer

```typescript
import { buildTokenTransfer, signTransaction, serializeTransactionHex } from "@secondlayer/stacks/transactions";

const tx = buildTokenTransfer({
  recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 1_000_000n,
  memo: "coffee",
  fee: 200n,
  nonce: 0n,
  publicKey: "03ab...",
});

const signed = signTransaction(tx, "0xprivatekey...");
const hex = serializeTransactionHex(signed);
// broadcast hex to the network
```

## Contract Call

```typescript
import { buildContractCall, signTransaction } from "@secondlayer/stacks/transactions";
import { Cl } from "@secondlayer/stacks/clarity";

const tx = buildContractCall({
  contractAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  contractName: "my-contract",
  functionName: "transfer",
  functionArgs: [Cl.uint(100), Cl.principal("SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE")],
  fee: 500n,
  nonce: 1n,
  publicKey: "03ab...",
});
```

## Contract Deploy

```typescript
import { buildContractDeploy, signTransaction } from "@secondlayer/stacks/transactions";

const tx = buildContractDeploy({
  contractName: "my-token",
  codeBody: "(define-fungible-token my-token)",
  fee: 10_000n,
  nonce: 2n,
  publicKey: "03ab...",
});
```

## Multi-Sig (2-of-3)

```typescript
import { buildTokenTransfer, signMultiSig } from "@secondlayer/stacks/transactions";

const tx = buildTokenTransfer({
  recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 1_000_000n,
  fee: 200n,
  nonce: 0n,
  publicKeys: [pk1, pk2, pk3],
  signaturesRequired: 2,
});

// Sign sequentially — auto-finalizes when threshold is met
const partial = signMultiSig(tx, key1, [pk1, pk2, pk3]);
const full = signMultiSig(partial, key2, [pk1, pk2, pk3]);
```

### Non-Sequential (SIP-027)

Signers can sign independently and combine later.

```typescript
import { buildTokenTransfer, signMultiSig, combineMultiSigSignatures } from "@secondlayer/stacks/transactions";
import { AddressHashMode } from "@secondlayer/stacks/transactions";

const tx = buildTokenTransfer({
  recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 1_000_000n,
  fee: 200n,
  nonce: 0n,
  publicKeys: [pk1, pk2, pk3],
  signaturesRequired: 2,
  hashMode: AddressHashMode.P2SH_NonSequential,
});

const sig1 = signMultiSig(tx, key1, [pk1, pk2, pk3]);
const sig3 = signMultiSig(tx, key3, [pk1, pk2, pk3]);
const combined = combineMultiSigSignatures(tx, [sig1, sig3]);
```

## Sponsored Transactions

```typescript
import { buildTokenTransfer, signTransaction, signSponsor } from "@secondlayer/stacks/transactions";

// Origin builds with sponsored: true and fee: 0
const tx = buildTokenTransfer({
  recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  amount: 1_000_000n,
  fee: 0n,
  nonce: 0n,
  publicKey: originPubKey,
  sponsored: true,
});

// Origin signs
const originSigned = signTransaction(tx, originKey);

// Sponsor sets fee and signs
const fullySigned = signSponsor(originSigned, sponsorKey);
```

## Enums

### ClarityVersion

| Name | Value |
|------|-------|
| `Clarity1` | 1 |
| `Clarity2` | 2 |
| `Clarity3` | 3 |
| `Clarity4` | 4 |
| `Clarity5` | 5 |

### TenureChangeCause

| Name | Value |
|------|-------|
| `BlockFound` | 0x00 |
| `Extended` | 0x01 |
| `ExtendedRuntime` | 0x02 |
| `ExtendedReadCount` | 0x03 |
| `ExtendedReadLength` | 0x04 |
| `ExtendedWriteCount` | 0x05 |
| `ExtendedWriteLength` | 0x06 |

## Wire Format

```typescript
import { serializeTransaction, serializeTransactionHex, deserializeTransaction } from "@secondlayer/stacks/transactions";

const bytes = serializeTransaction(signed);   // Uint8Array
const hex = serializeTransactionHex(signed);  // string
const parsed = deserializeTransaction(hex);   // StacksTransaction
```
