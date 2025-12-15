# Clarity Types Audit (gpt-5.1-codex-max-high)

Scope: @secondlayer/clarity-types package. Focus: fragile, hardcoded, regex-like solutions that should lean on existing tooling for scalable and robust Clarity type coverage.

## Findings

1) Principal validation is regex-based and bypasses the canonical address/parsing utilities.
- Evidence: Regex constants and guards rely on `/^S[0-9A-Z]{39,40}/` variants and `test()` calls (`packages/clarity-types/src/types/primitives.ts`, `packages/clarity-types/src/validation/guards.ts`).
- Risks: No c32 checksum verification; network prefixes beyond `S` are not enforced; contract IDs aren’t parsed; malformed principals can slip through or valid testnet forms could be rejected under edge cases.
- Recommendation: Replace regex validation with Stacks JS primitives: `@stacks/transactions` (`validateStacksAddress`, `principalCV`, `contractPrincipalCV`, `parsePrincipalString`) which already perform c32check decoding and contract-name validation. This avoids maintaining home-grown regex and stays aligned with protocol rules.

2) Runtime conversion only validates primitives; composite Clarity types are left unvalidated.
- Evidence: `jsToClarity` handles a few primitives and buffers/strings, then returns values for lists/tuples/optionals/responses without checks (`packages/clarity-types/src/converters/index.ts`, TODO at the composite branch).
- Risks: Nested structures, list length limits, tuple field shapes, optional/response envelopes, and nested principals are not validated. Downstream code may send malformed arguments while appearing “validated”.
- Recommendation: Drive conversion off official Clarity value constructors from `@stacks/transactions` (`uintCV`, `intCV`, `boolCV`, `bufferCV`, `stringAsciiCV`, `stringUtf8CV`, `listCV`, `tupleCV`, `optionalCV`, `responseOkCV/responseErrorCV`). These enforce length/shape and will fail fast. Use ABI metadata to recurse through types instead of manual branching.

3) String/buffer validation is minimal and home-built.
- Evidence: ASCII strings only check JS type and length, not character set; UTF-8 uses `TextEncoder` length only; buffers allow any `Uint8Array` up to max length (`packages/clarity-types/src/converters/index.ts`).
- Risks: Non-ASCII characters pass for `string-ascii`; buffer sizing/encoding rules rely on ad-hoc checks; behavior may drift from Clarity’s exact constraints.
- Recommendation: Delegate to `stringAsciiCV` / `stringUtf8CV` / `bufferCV` in `@stacks/transactions` so encoding and length constraints match the VM. If staying local, add explicit ASCII byte validation and enforce exact/expected lengths from ABI.

4) ABI shape/types are redefined manually and omit parts of the canonical schema.
- Evidence: Custom `ClarityContract`, `ClarityFunction`, and `ClarityType` definitions (`packages/clarity-types/src/abi/functions.ts`, `packages/clarity-types/src/types/composites.ts`) exclude newer ABI fields (token definitions, fungible/non-fungible tokens, maps metadata, traits) present in `@stacks/transactions`’ `ClarityAbi` types.
- Risks: Drift from upstream ABI spec; generated ABIs from `@stacks/cli` may not type-check or be fully covered; downstream tooling cannot rely on parity with Stacks’ standard library.
- Recommendation: Import and reuse the official `ClarityAbi`, `ClarityAbiFunction`, and `ClarityAbiType*` types from `@stacks/transactions` instead of duplicating. This removes manual maintenance and ensures forward compatibility when the ABI evolves.

5) List/collection guards ignore ABI length constraints.
- Evidence: `isArray` only checks every element against a guard and never enforces declared list length; composite validation is TODO (`packages/clarity-types/src/validation/guards.ts`, `packages/clarity-types/src/converters/index.ts`).
- Risks: Calls can send lists longer than ABI limits and still be considered “validated.”
- Recommendation: When adopting ABI-driven recursion, include list length enforcement (exact or max per Clarity spec). The `listCV` helper already enforces lengths when given the intended size.

## Suggested next steps
- Swap regex/address checks for Stacks JS address/principal utilities to gain checksum and contract-name validation for free.
- Refactor `jsToClarity` into an ABI-driven recursive converter that builds Clarity Values via `@stacks/transactions`, covering lists/tuples/optionals/responses and enforcing lengths/encodings.
- Replace bespoke ABI/type definitions with the upstream `ClarityAbi*` types to avoid drift and improve coverage for tokens/maps/traits.
- Augment tests to cover the above (invalid principals that fail checksum, over-length lists/buffers, non-ASCII strings, malformed tuples) to lock in the stronger behavior.

