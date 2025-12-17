# clarity-types

TypeScript types for Clarity contract ABIs. Full type inference, zero runtime dependencies.

## Install

```bash
bun add clarity-types
```

## Quick Start

```typescript
import type { ClarityContract, ExtractFunctionArgs, ExtractFunctionOutput } from 'clarity-types'

const abi = {
  functions: [{
    name: 'transfer',
    access: 'public',
    args: [
      { name: 'amount', type: 'uint128' },
      { name: 'recipient', type: 'principal' },
    ],
    outputs: { response: { ok: 'bool', error: 'uint128' } },
  }],
} as const satisfies ClarityContract

type TransferArgs = ExtractFunctionArgs<typeof abi, 'transfer'>
// { amount: bigint, recipient: string }

type TransferOutput = ExtractFunctionOutput<typeof abi, 'transfer'>
// { ok: boolean } | { err: bigint }
```

## Type Mappings

| Clarity | TypeScript |
|---------|------------|
| `uint128`, `int128` | `bigint` |
| `bool` | `boolean` |
| `principal`, `trait_reference` | `string` |
| `(string-ascii N)`, `(string-utf8 N)` | `string` |
| `(buff N)` | `Uint8Array` |
| `(optional T)` | `T \| null` |
| `(response OK ERR)` | `{ ok: OK } \| { err: ERR }` |
| `(list N T)` | `T[]` |
| `{tuple}` | typed object |

## Extractors

```typescript
// functions
type Names = ExtractFunctionNames<Contract>
type Args = ExtractFunctionArgs<Contract, 'fn-name'>
type Output = ExtractFunctionOutput<Contract, 'fn-name'>
type Public = ExtractPublicFunctions<Contract>
type ReadOnly = ExtractReadOnlyFunctions<Contract>
type Private = ExtractPrivateFunctions<Contract>

// maps
type MapNames = ExtractMapNames<Contract>
type Key = ExtractMapKey<Contract, 'map-name'>
type Value = ExtractMapValue<Contract, 'map-name'>

// variables
type VarNames = ExtractVariableNames<Contract>
type VarType = ExtractVariableType<Contract, 'var-name'>
type Constants = ExtractConstants<Contract>
type DataVars = ExtractDataVars<Contract>

// tokens
type FTs = ExtractFungibleTokenNames<Contract>
type NFTs = ExtractNonFungibleTokenNames<Contract>
type NFTAsset = ExtractNFTAssetType<Contract, 'nft-name'>

// traits
type Defined = ExtractDefinedTraitNames<Contract>
type Implemented = ExtractImplementedTraits<Contract>
```

## Type Guards

```typescript
import { isUint128, isPrincipal, isOkResponse } from 'clarity-types'

if (isUint128(value)) {
  // bigint in [0, 2^128-1]
}

if (isPrincipal(addr)) {
  // valid Stacks principal
}

if (isOkResponse(result)) {
  console.log(result.ok)
} else {
  console.log(result.err)
}
```

## @stacks/connect Integration

```typescript
import type { ContractCallParams, ReadOnlyCallParams } from 'clarity-types'
import { openContractCall, callReadOnlyFunction } from '@stacks/connect'

// generated interfaces return params compatible with @stacks/connect
await openContractCall({
  ...contract.transfer({ amount: 100n, recipient: "SP..." }),
  onFinish: (data) => console.log(data),
})
```

## License

MIT
