# @secondlayer/stacks

## 0.2.2

### Patch Changes

- Fix SIP-005 wire format: post condition field order, TokenTransfer memo encoding, buffer underflow guards, add missing TenureChangeCause/ClarityVersion variants.

## 0.2.1

### Patch Changes

- Fix duplicate export of `combineMultiSigSignatures` caused by dynamic import creating a separate bunup chunk. Replaced with static import.

## 0.2.0

### Minor Changes

- Convert contract method names from kebab-case to camelCase for better TypeScript ergonomics (e.g. `contract.read.getBalance()` instead of `contract.read["get-balance"]()`). Clean up unused imports and fix test types.

## 0.1.0

### Minor Changes

- a070de2: Support all 9 Stacks transaction payload types in deserializer/serializer. Fixes "Unknown payload type: 4" error during genesis sync by adding Coinbase, CoinbaseToAltRecipient, PoisonMicroblock, TenureChange, and NakamotoCoinbase.

## 0.0.4

### Patch Changes

- Fix `.extend()` chaining losing previous extensions. Calling `.extend(pox()).extend(bns())` now correctly preserves all extensions.

## 0.0.3

### Patch Changes

- Return `null` instead of throwing when BNS names don't exist. Fixes `resolveName`, `getPrimaryName`, and `getNameId` to catch `ContractResponseError` for not-found cases.

## 0.0.2

### Patch Changes

- Fix extension type inference in built .d.ts files. `bns()`, `pox()`, and `stackingDao()` now emit full method types instead of `{}` after `.extend()`.
