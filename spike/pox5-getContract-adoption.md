# st-013 spike: adopting `getContract` for pox5 boot-contract actions

Date: 2026-07-17. Spike artifacts: `spike/pox5-getContract/` (`extract-abi.ts`,
`pox5-abi.ts`, `poc.ts`, `negative-check.ts`). No production files modified.

## 1. Summary — verdict: GO (with a curated subset ABI)

`getContract` can replace pox5's raw `callContract`/`readContract` packing for
every wallet action and every single read pox5 exposes today. Typed reads work,
`buildCall.stake` produces **byte-identical** function args to the current
`stake()` path, compile-time arg checking works, and the one batched helper
(`getStakerState`) keeps using the standalone `multicall` action — a gap, not
a blocker. The only real design decision is the ABI itself: the full extracted
pox-5 interface is 3,525 lines (88 functions), far more than pox5 needs. A
curated subset covering the 25 functions pox5 actually calls is ~1,139 lines
of JSON-style literal (denser if hand-formatted like `pox/abi.ts`, est.
~450–500 lines) and is mechanically regenerable from Clarinet with the spike's
extraction script.

## 2. What works (evidence)

- **ABI extraction (Step 1).** `extract-abi.ts` pulls the pox-5 interface from
  `initSimnet` (same path the simnet pin tests use) and emits an as-const
  `AbiContract` literal that `tsc` accepts when passed to `getContract`.
  88 functions after filtering (18 public, 70 read-only), 25 maps, 70
  variables. All 25 function names pox5 calls exist in the interface.
  Type constructors used: `bool, list, optional, principal, response,
  string-ascii, trait_reference, tuple, uint128` — **all supported** by
  `AbiType`/`jsToClarityValue` (no Epoch 4.0 surprises).
- **Typed reads (Step 2).** `pox5.read.getStakerInfo({ staker })` executed
  against a mock transport and returned a JS-mapped object:
  `{ amountUstx: 100000000000n, firstRewardCycle: 3n, numCycles: 12n, signer: "SP…" }`
  — camelCase keys, `uint`→`bigint`, `none`→`null`. Auto-camelCase works for
  pox-5 names (`get-bond-l1-unlock-height` → `getBondL1UnlockHeight`).
- **Compile-time checking (Step 2 negative case).** `negative-check.ts` fails
  `tsc` with exactly the two expected errors: `TS2353` on a wrong arg name,
  `TS2322` on `amountUstx: "not-a-bignum"` (`string` not assignable to
  `bigint`).
- **Typed calls / `buildCall` (Step 3).** `poc.ts` ran current
  `stake(client, …)` through a capture transport and `pox5.buildCall.stake(…)`
  on the same client; the serialized function-arg hex arrays are identical
  (5 args, incl. `trait_reference` signer-manager → contract principal CV, and
  `signer-calldata` none → `09`). `buildCall` also resolves nonce + mid fee
  estimate and supports `postConditions`/`postConditionMode`/`sponsored` —
  post-conditions are passed through unchanged, so the new Epoch 4.0
  `Staking`/`Pox` PCs work identically.
- **Multicall (Step 4).** `ContractInstance` exposes exactly
  `read`, `call`, `buildCall`, `maps` — **no `.multicall`**. The standalone
  `multicall` action (`actions/public/multicall.ts`) remains available, so
  `getStakerState` can stay exactly as-is (manual `Cl.principal` packing for
  its 4 batched reads). Not a blocker; documented as a gap below.

## 3. Blockers and friction points

1. **ABI size / commitment.** Full literal: 3,525 lines (functions alone
   ~2,425). Committing all 88 functions is unjustified for 25 used ones.
   Mitigation: commit a curated subset (`pox5/abi.ts`, est. ~450–500 lines in
   `pox/abi.ts` house style) and keep the extraction script as the regen tool.
2. **Clarinet JSON ≠ `AbiContract` shape.** Four mechanical mappings are
   required (all implemented in `extract-abi.ts`): `read_only` → `read-only`;
   `outputs: { type }` unwrap; `{ buffer: { length } }` → `{ buff }`; drop
   `private` functions (31 of them). A committed subset ABI copied from
   Clarinet output by hand must apply the same mappings.
3. **Optional args become required-with-`null`.** `(optional (buff 500))`
   types as `signerCalldata: Uint8Array | null` — callers must pass
   `null` explicitly; omitting the key is a compile error. Slightly more
   friction than today's `signerCalldata?`. (Mitigable later by marking
   optional args optional in the type mapping — a `getContract` change, out of
   scope here.)
4. **Read return shape changes (breaking).** Today pox5 reads return raw
   `ClarityValue`; `getContract` reads return JS-mapped values (bigints,
   camelCase keys, `null` for `none`, auto-unwrapped `response` ok-branches
   with `ContractResponseError` on err). Adopting `getContract` changes the
   public types of all 12 `pox5` extension reads. The `pox` module already
   accepts this pattern (casts to `StackerInfo | null` etc.). pox5 is new
   (pre-1.0 consumers few), so the break is acceptable but must be called out
   in the release notes.
5. **Arg-name drift.** The on-chain arg is `start-burn-ht` → camel
   `startBurnHt`; pox5's current param is `startBurnHeight`. Adoption renames
   this parameter (or keeps a thin wrapper that maps it).
6. **Multicall gap.** `getStakerState` cannot go through `getContract`; it
   keeps manual packing. Low impact (one helper, 4 calls).

## 4. Migration path (if GO confirmed)

Effort: **M** (half a day incl. tests). Files:

1. **New `packages/stacks/src/pox5/abi.ts`** — curated 25-function subset of
   the extracted ABI, formatted in `pox/abi.ts` house style. Source of truth
   note: regenerate via the extraction script when stacks-core bumps pox-5.
2. **`packages/stacks/src/pox5/actions.ts`** — replace the `call`/`read`
   wrappers with a `getPox5Contract(client)` helper (mirrors
   `pox/actions.ts:17-25`). Keep the exported function names/signatures where
   possible; wallet actions become one-line delegations to
   `contract.call.*`; reads delegate to `contract.read.*` and return mapped
   types. `L1LockupOutput`/`BtcLockup` tuple packing for `register-for-bond`
   moves into the typed args object (the ABI tuple types accept plain JS
   objects — verify nested `leaf-hashes` list handling during the build).
3. **`packages/stacks/src/pox5/extension.ts`** — `getStakerState` unchanged
   (raw `multicall`); read method return types updated from `ClarityValue` to
   the mapped TS types.
4. **Tests** — existing simnet pin tests (`actions.simnet.test.ts`,
   `onchain.simnet.test.ts`) remain valid unchanged: they decode the broadcast
   payload and pin it against the Clarinet interface, which now also transitively
   validates the committed subset ABI. Add one test asserting every function in
   `pox5/abi.ts` exists in the Clarinet interface with matching args (cheap
   drift guard).
5. **Optional follow-up (not required):** teach `getContract`'s arg mapping to
   mark `(optional …)` args as optional TS properties, removing friction
   point 3 for all consumers.

## 5. Trade-offs

| | Keep raw packing (status quo) | Adopt `getContract` (subset ABI) |
|---|---|---|
| Arg safety | Runtime-only; simnet pin tests catch drift | Compile-time name+type checking (proven: TS2353/TS2322) |
| Reads | Raw `ClarityValue`, caller decodes | JS-mapped types, auto-unwrap, but breaking change to extension types |
| Unsigned tx flows | Not exposed | `buildCall.*` for every public fn, byte-identical payloads (proven) |
| ABI maintenance | None | ~450–500-line committed literal + regen script; drift guarded by simnet pins |
| Multicall | Works | Unchanged (still manual — `getContract` has no multicall) |
| Consistency | Diverges from `pox` module pattern | Matches `pox` module (`getContract` + committed ABI) |

Recommendation: **GO** with the curated subset ABI. The spike found no
unsupported types and no payload divergence; the costs are one-time (ABI
commit, read-type break) and the drift risk is already covered by the existing
simnet pin tests.
