# clarity-types

TypeScript type definitions and utilities for Clarity smart contract ABIs. Provides compile-time type inference and runtime validation for Clarity contracts on the Stacks blockchain.

## Features

- 🎯 **Full type inference** - Automatically infer TypeScript types from Clarity contract ABIs
- 🔒 **Type safety** - Catch type errors at compile time, not runtime
- 📦 **Zero dependencies** - Pure TypeScript with no runtime dependencies
- 🚀 **Lightweight** - Tree-shakeable and minimal bundle impact
- ✅ **Runtime validation** - Optional runtime type guards for safety
- 🔧 **Integration ready** - Designed to work with @stacks/connect

## Installation

```bash
npm install clarity-types
# or
yarn add clarity-types
# or
bun add clarity-types
```

## Quick Start

```typescript
import type { ClarityContract, ExtractFunctionArgs } from "clarity-types";

// Define your contract ABI with const assertion
const contractAbi = {
  functions: [
    {
      name: "transfer",
      access: "public",
      args: [
        { name: "amount", type: "uint128" },
        { name: "sender", type: "principal" },
        { name: "recipient", type: "principal" },
      ],
      outputs: { response: { ok: "bool", error: "uint128" } },
    },
  ],
} as const satisfies ClarityContract;

// Extract typed function arguments
type TransferArgs = ExtractFunctionArgs<typeof contractAbi, "transfer">;
// Result: { amount: bigint, sender: string, recipient: string }

// Use with @stacks/connect
const transfer = (args: TransferArgs) => ({
  contractAddress: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9",
  contractName: "my-token",
  functionName: "transfer",
  functionArgs: [args.amount, args.sender, args.recipient],
});
```

## Type Mappings

| Clarity Type        | TypeScript Type              |
| ------------------- | ---------------------------- |
| `uint128`           | `bigint`                     |
| `int128`            | `bigint`                     |
| `bool`              | `boolean`                    |
| `principal`         | `string`                     |
| `trait_reference`   | `string`                     |
| `(string-ascii N)`  | `string`                     |
| `(string-utf8 N)`   | `string`                     |
| `(buff N)`          | `Uint8Array`                 |
| `(optional T)`      | `T \| null`                  |
| `(response OK ERR)` | `{ ok: OK } \| { err: ERR }` |
| `(list N T)`        | `T[]`                        |
| `{tuple}`           | `object` with typed fields   |

## API Reference

### Type Extraction

```typescript
// Extract all function names
type Functions = ExtractFunctionNames<Contract>;

// Extract function arguments as object
type Args = ExtractFunctionArgs<Contract, "function-name">;

// Extract function return type
type Output = ExtractFunctionOutput<Contract, "function-name">;

// Extract only public functions
type PublicFunctions = ExtractPublicFunctions<Contract>;

// Extract only read-only functions
type ReadOnlyFunctions = ExtractReadOnlyFunctions<Contract>;

// Extract private functions
type PrivateFunctions = ExtractPrivateFunctions<Contract>;
```

### Map and Variable Extraction

```typescript
// Extract map types for typed map operations
type MapNames = ExtractMapNames<Contract>;
type BalanceKey = ExtractMapKey<Contract, "balances">;
type BalanceValue = ExtractMapValue<Contract, "balances">;

// Extract variable types
type VarNames = ExtractVariableNames<Contract>;
type OwnerType = ExtractVariableType<Contract, "contract-owner">;

// Filter by access
type Constants = ExtractConstants<Contract>;
type DataVars = ExtractDataVars<Contract>;
```

### Token Extraction

```typescript
// Get token names
type FTNames = ExtractFungibleTokenNames<Contract>;
type NFTNames = ExtractNonFungibleTokenNames<Contract>;

// Get NFT asset identifier type
type NFTAsset = ExtractNFTAssetType<Contract, "my-nft">;
```

### Trait Extraction

```typescript
// Get defined trait names
type DefinedTraits = ExtractDefinedTraitNames<Contract>;

// Get implemented trait identifiers
type ImplementedTraits = ExtractImplementedTraits<Contract>;
```

### Type Guards

```typescript
import { isUint128, isPrincipal, isOkResponse } from "clarity-types";

// Validate values at runtime
if (isUint128(value)) {
  // value is bigint between 0 and 2^128-1
}

if (isPrincipal(address)) {
  // address is a valid Stacks principal
}

if (isOkResponse(result)) {
  console.log("Success:", result.ok);
} else {
  console.log("Error:", result.err);
}
```

### Value Conversion

```typescript
import { jsToClarity, validateArgs } from "clarity-types";

// Validate and convert JS values to Clarity types
const validated = jsToClarity("uint128", 123n); // Returns 123n or throws

// Validate function arguments
validateArgs(functionAbi, {
  amount: 100n,
  recipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
});
```

## Complex Types Example

```typescript
const complexAbi = {
  functions: [
    {
      name: "create-proposal",
      access: "public",
      args: [
        {
          name: "details",
          type: {
            tuple: [
              { name: "title", type: { "string-utf8": { length: 100 } } },
              { name: "amount", type: "uint128" },
              {
                name: "recipients",
                type: {
                  list: {
                    type: "principal",
                    length: 10,
                  },
                },
              },
            ],
          },
        },
      ],
      outputs: {
        response: {
          ok: "uint128",
          error: { "string-ascii": { length: 100 } },
        },
      },
    },
  ],
} as const satisfies ClarityContract;

type ProposalArgs = ExtractFunctionArgs<typeof complexAbi, "create-proposal">;
// Result: {
//   details: {
//     title: string
//     amount: bigint
//     recipients: string[]
//   }
// }
```

## Integration with @stacks/connect

This library provides types for generating parameters compatible with @stacks/connect and @stacks/transactions:

```typescript
import { openContractCall, callReadOnlyFunction } from "@stacks/connect";
import type { ContractInterface } from "clarity-types";

// Generated contract interface (usually created by @stacks/cli)
const contract: ContractInterface<typeof contractAbi> = {
  // Write functions return ContractCallParams
  transfer: (args) => ({
    contractAddress: "SP...",
    contractName: "my-token",
    functionName: "transfer",
    functionArgs: [args.amount, args.sender, args.recipient],
  }),

  // Read-only functions return ReadOnlyCallParams
  getBalance: (args) => ({
    contractAddress: "SP...",
    contractName: "my-token",
    functionName: "get-balance",
    functionArgs: [args.address],
  }),
};

// Use with @stacks/connect for write operations
await openContractCall({
  ...contract.transfer({
    amount: 1000n,
    sender: "SP...",
    recipient: "SP...",
  }),
  onFinish: (data) => {
    console.log("Transaction:", data);
  },
});

// Use with @stacks/transactions for read operations
const result = await fetchCallReadOnlyFunction({
  ...contract.getBalance({ address: "SP..." }),
  senderAddress: "SP...", // any address works for read-only
});
```

## What This Library Does NOT Do

- **No network calls** - This is a type-only library
- **No transaction building** - Use @stacks/transactions
- **No wallet interaction** - Use @stacks/connect
- **No code generation** - Use @stacks/cli (coming soon)

This library focuses solely on providing type safety for Clarity contract ABIs.

## License

MIT
