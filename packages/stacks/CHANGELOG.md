# @secondlayer/stacks

## 0.0.4

### Patch Changes

- Fix `.extend()` chaining losing previous extensions. Calling `.extend(pox()).extend(bns())` now correctly preserves all extensions.

## 0.0.3

### Patch Changes

- Return `null` instead of throwing when BNS names don't exist. Fixes `resolveName`, `getPrimaryName`, and `getNameId` to catch `ContractResponseError` for not-found cases.

## 0.0.2

### Patch Changes

- Fix extension type inference in built .d.ts files. `bns()`, `pox()`, and `stackingDao()` now emit full method types instead of `{}` after `.extend()`.
