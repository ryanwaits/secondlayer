---
"@secondlayer/cli": patch
---

Fix react plugin generated hooks, which emitted code that didn't compile against the current `@secondlayer/stacks`:

- Imports now target real subpaths (`Cl` from `/clarity`, `validateStacksAddress` from `/utils`, `PostCondition` from `/postconditions`) instead of the root barrel.
- `useReadContract` and per-contract read hooks no longer reference `fetchCallReadOnlyFunction` (never existed in the SDK) or the `.read.*` namespace (removed with the actions plugin); they call the generated contract descriptor and an inline `/v2/contracts/call-read` helper, converting results through the ABI output type.
- `useConnect` matches the SDK's zero-argument `connect()`.
- `useWaitForTransaction` polling now stops on completion under both react-query v4 (data) and v5 (query object) callback signatures.
