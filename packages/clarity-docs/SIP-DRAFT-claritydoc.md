# SIP-XXX: ClarityDoc - Documentation Comment Standard for Clarity

## Preamble

| Field | Value |
|-------|-------|
| SIP Number | XXX (assigned upon acceptance) |
| Title | ClarityDoc - Documentation Comment Standard for Clarity |
| Authors | Ryan Waits <ryan@secondlayer.dev> |
| Consideration | Technical |
| Type | Standard |
| Status | Draft |
| Created | 2024-12-21 |
| License | BSD-2-Clause |
| Layer | Applications |

## Abstract

This SIP proposes **ClarityDoc**, a structured documentation comment format for Clarity smart contracts. ClarityDoc extends the existing `;;` comment syntax with `@tag` annotations to provide machine-readable documentation for functions, variables, maps, and contracts.

ClarityDoc enables:
- Automated API documentation generation
- IDE integration with rich hover information
- Documentation coverage analysis
- Consistent documentation practices across the ecosystem

The format is designed to be backwards compatible—existing `;;` comments remain valid and are interpreted as `@notice` tags.

## License and Copyright

This SIP is made available under the terms of the BSD-2-Clause license.

## Introduction

### Problem Statement

Clarity is the smart contract language for the Stacks blockchain, yet it lacks a standardized documentation format. Unlike other smart contract and programming languages:

| Language | Documentation Standard | Adoption |
|----------|----------------------|----------|
| Solidity | NatSpec (`@param`, `@return`, `@notice`) | Universal |
| TypeScript | JSDoc/TSDoc | Universal |
| Rust | rustdoc (`///` comments with Markdown) | Universal |
| Python | Docstrings (Google, NumPy, Sphinx) | High |
| **Clarity** | **None** | N/A |

Developers currently use ad-hoc `;;` comments without consistent structure, leading to:

1. **No automated documentation** - Tools cannot extract structured API docs
2. **Inconsistent practices** - Each project documents differently
3. **Poor IDE support** - No hover information or parameter hints
4. **No coverage metrics** - Cannot measure documentation completeness
5. **Difficult auditing** - Auditors must manually parse comments

### Solution

ClarityDoc provides a lightweight, familiar tag-based system that:

- **Preserves backwards compatibility** - Plain `;;` comments still work
- **Enables automation** - Machine-readable structure for tooling
- **Follows conventions** - Familiar to developers from NatSpec/JSDoc
- **Supports validation** - Tools can verify `@param` matches actual args

## Specification

### Comment Syntax

ClarityDoc comments use the existing `;;` prefix with optional `@tag` annotations:

```clarity
;; @desc Human-readable description of what this does
;; @param name Description of the parameter
;; @ok Description of the success value
(define-public (function-name (name type))
  ...)
```

Comments without tags are treated as `@desc`:

```clarity
;; This is equivalent to @desc This is equivalent to
(define-public (example) ...)
```

### Supported Tags

#### Contract-Level Tags

| Tag | Description | Example |
|-----|-------------|---------|
| `@contract` | Contract name/title | `@contract Token Contract` |
| `@author` | Author name and/or email | `@author Alice <alice@example.com>` |
| `@desc` | Human-readable contract description | `@desc A fungible token implementation` |
| `@dev` | Developer notes, implementation details | `@dev Uses SIP-010 standard` |
| `@version` | Version or deployment info | `@version 1.0.0` |
| `@uri` | Off-chain documentation URL | `@uri https://docs.example.com/token` |
| `@hash` | Documentation hash for integrity | `@hash sha256:abc123...` |

#### Function Tags

| Tag | Description | Example |
|-----|-------------|---------|
| `@desc` | What the function does | `@desc Transfer tokens to recipient` |
| `@dev` | Implementation notes | `@dev Checks balance before transfer` |
| `@param` | Parameter description | `@param amount The number of tokens` |
| `@ok` | Success value description | `@ok The new balance` |
| `@err` | Error case description | `@err ERR_INSUFFICIENT_BALANCE Not enough tokens` |
| `@post` | Asset transfer/mint postcondition | `@post stx Transfers STX to recipient` |
| `@prints` | Print statements triggered | `@prints {from: principal, to: principal} transfer Emitted on success` |
| `@example` | Usage example | `@example (transfer u100 'SP123...)` |

**Note on `@post`:** This tag documents asset movements (STX, FTs, NFTs) that occur as a result of calling the function. This helps wallets display what assets will leave the user's account. See Clarity 4's `restrict-assets?` and `with-stx`/`with-ft`/`with-nft` for programmatic asset restrictions.

**`@post` Asset Types:**

| Asset Type | Syntax | Example |
|------------|--------|---------|
| STX | `@post stx <description>` | `@post stx Transfers 10 STX to contract` |
| Fungible Token | `@post <ft-name> <description>` | `@post token Transfers `amount` tokens to recipient` |
| NFT | `@post <nft-name> <description>` | `@post my-nft Transfers NFT `token-id` to recipient` |

**FT Examples:**
```clarity
;; @desc Transfer tokens between accounts
;; @param amount Number of tokens to transfer
;; @param recipient Destination address
;; @post my-token Transfers `amount` tokens from sender to recipient
;; @post stx Transfers 1 STX fee to contract
;; @ok True on successful transfer
(define-public (transfer (amount uint) (recipient principal))
  (begin
    (try! (ft-transfer? my-token amount tx-sender recipient))
    (try! (stx-transfer? u1000000 tx-sender (as-contract tx-sender)))
    (ok true)))

;; @desc Mint new tokens
;; @param amount Number of tokens to mint
;; @param recipient Address to receive tokens
;; @post my-token Mints `amount` new tokens to recipient
;; @ok True on successful mint
(define-public (mint (amount uint) (recipient principal))
  (begin
    (try! (ft-mint? my-token amount recipient))
    (ok true)))

;; @desc Burn tokens from sender
;; @param amount Number of tokens to burn
;; @post my-token Burns `amount` tokens from sender (destroyed)
;; @ok True on successful burn
(define-public (burn (amount uint))
  (begin
    (try! (ft-burn? my-token amount tx-sender))
    (ok true)))
```

**NFT Examples:**
```clarity
;; @desc Transfer an NFT to a new owner
;; @param token-id The NFT identifier to transfer
;; @param recipient New owner address
;; @post my-nft Transfers NFT `token-id` from sender to recipient
;; @ok True on successful transfer
(define-public (transfer-nft (token-id uint) (recipient principal))
  (begin
    (try! (nft-transfer? my-nft token-id tx-sender recipient))
    (ok true)))

;; @desc Mint a new NFT
;; @param token-id The NFT identifier to mint
;; @param recipient Owner of the new NFT
;; @post my-nft Mints new NFT `token-id` to recipient
;; @ok True on successful mint
(define-public (mint (token-id uint) (recipient principal))
  (begin
    (try! (nft-mint? my-nft token-id recipient))
    (ok true)))

;; @desc Burn an NFT
;; @param token-id The NFT identifier to burn
;; @post my-nft Burns NFT `token-id` from sender (destroyed)
;; @ok True on successful burn
(define-public (burn (token-id uint))
  (begin
    (try! (nft-burn? my-nft token-id tx-sender))
    (ok true)))
```

#### Map Tags

| Tag | Description | Example |
|-----|-------------|---------|
| `@desc` | Map purpose | `@desc Stores user balances` |
| `@key` | Key type description | `@key principal The account address` |
| `@value` | Value type description | `@value uint The token balance` |

#### Variable/Constant Tags

| Tag | Description | Example |
|-----|-------------|---------|
| `@desc` | Variable purpose | `@desc Total supply of tokens` |
| `@dev` | Implementation notes | `@dev Updated on mint/burn` |
| `@err` | Error constant description (constants only) | `@err Balance too low` |
| `@example` | Usage example (constants only) | `@example (asserts! (> balance u0) ERR_ZERO)` |

**Error Constants:** When `@err` is used on a constant, the parser extracts the error code from `(err uXX)` values, enabling wallets and explorers to display human-readable error messages instead of cryptic codes like `(err u67)`.

#### Universal Tags

These tags can be used on any definition:

| Tag | Description | Example |
|-----|-------------|---------|
| `@deprecated` | Deprecation notice | `@deprecated Use transfer-v2 instead` |
| `@see` | Cross-reference | `@see transfer-v2` |
| `@custom:*` | Custom tags | `@custom:security Audited by XYZ` |

### Grammar

```ebnf
doc-block     = { doc-line } ;
doc-line      = ";;" [ whitespace ] [ tag-content | free-text ] newline ;
tag-content   = "@" tag-name [ whitespace tag-arg ] [ whitespace description ] ;
tag-name      = identifier | "custom:" identifier ;
tag-arg       = identifier ;
description   = { any-char-except-newline } ;
identifier    = letter { letter | digit | "-" | "_" } ;
free-text     = { any-char-except-newline } ;
```

### Attachment Rules

1. **Immediate attachment**: A doc block attaches to the immediately following `define-*` expression
2. **Contract header**: The first doc block containing `@contract` or `@author` is the contract header, regardless of what follows
3. **Block separation**: An empty line between `;;` comments creates separate doc blocks
4. **No attachment**: Doc blocks not followed by a `define-*` (after the header) are ignored

### Complete Example

```clarity
;; @contract Counter Contract
;; @author Alice <alice@example.com>
;; @desc A simple incrementing counter for demonstration
;; @dev Deployed to mainnet at SP123...
;; @version 1.0.0
;; @uri https://docs.example.com/counter
;; @hash sha256:a1b2c3d4e5f6...

;; @desc Maximum allowed counter value
(define-constant MAX_VALUE u1000000)

;; @err Amount must be greater than zero
(define-constant ERR_ZERO_AMOUNT (err u1))

;; @err Counter would exceed MAX_VALUE
(define-constant ERR_OVERFLOW (err u2))

;; @err Caller is not authorized
(define-constant ERR_UNAUTHORIZED (err u100))

;; @desc The current counter value
;; @dev Initialized to zero on deployment
(define-data-var counter uint u0)

;; @desc Tracks increment history per user
;; @key principal The user's address
;; @value uint Total increments by this user
(define-map user-increments principal uint)

;; @desc Increment the counter by a specified amount
;; @param amount The value to add to the counter
;; @ok The new counter value after incrementing
;; @err ERR_OVERFLOW Counter would exceed MAX_VALUE
;; @err ERR_ZERO_AMOUNT Amount must be greater than zero
;; @prints {amount: uint, new-value: uint} counter-incremented Emitted after successful increment
;; @example (increment u5)
(define-public (increment (amount uint))
  (let ((current (var-get counter))
        (new-value (+ current amount)))
    (asserts! (> amount u0) ERR_ZERO_AMOUNT)
    (asserts! (<= new-value MAX_VALUE) ERR_OVERFLOW)
    (var-set counter new-value)
    (print { event: "counter-incremented", amount: amount, new-value: new-value })
    (ok new-value)))

;; @desc Get the current counter value
;; @ok The current counter value as uint
(define-read-only (get-counter)
  (ok (var-get counter)))

;; @desc Reset counter to zero
;; @dev Only callable by contract owner
;; @deprecated Use set-counter instead for more flexibility
(define-public (reset)
  (begin
    (var-set counter u0)
    (ok u0)))
```

## Related Work

### NatSpec (Ethereum/Solidity)

NatSpec is the documentation standard for Solidity smart contracts, using `///` or `/** */` comments with tags like `@notice`, `@param`, `@return`. ClarityDoc adopts some NatSpec conventions but uses Clarity-native terminology.

**Differences:**
- ClarityDoc uses `;;` prefix (Clarity's comment syntax)
- ClarityDoc uses `@ok`/`@err` instead of `@return`/`@error` to match Clarity's response types
- ClarityDoc uses `@desc` instead of `@notice` (aligned with original SIP-014 proposal)
- ClarityDoc adds `@post` for postconditions (asset transfers)
- ClarityDoc adds `@key`/`@value` for map documentation

### JSDoc/TSDoc (JavaScript/TypeScript)

JSDoc uses `/** */` comments with `@param`, `@returns`, `@example`. TSDoc extends this for TypeScript.

**Differences:**
- ClarityDoc uses `@ok`/`@err` to match Clarity's response types
- ClarityDoc uses `@desc` for descriptions (aligned with SIP-014)
- ClarityDoc adds Clarity-specific tags for maps and contract metadata

### rustdoc (Rust)

Rust uses `///` comments with Markdown formatting. Documentation is tightly integrated with the compiler.

**Differences:**
- ClarityDoc uses structured tags rather than pure Markdown
- Tags provide machine-readable semantics for tooling

## Backwards Compatibility

ClarityDoc is fully backwards compatible:

1. **Existing comments are valid**: Any `;;` comment without tags is treated as `@desc`
2. **No syntax changes**: Uses existing Clarity comment syntax
3. **Opt-in adoption**: Projects can adopt incrementally
4. **Graceful degradation**: Tools SHOULD handle missing documentation gracefully

Parsers implementing this SIP:
- MUST accept comments without tags as `@desc` content
- MUST ignore unknown tags (with optional warning)
- SHOULD NOT require any specific tags to be present

## Design Decision: `;;` vs `;;;`

This SIP uses the standard `;;` comment syntax rather than introducing a new `;;;` doc-comment syntax. This decision was made for several reasons:

### Why Not `;;;`?

1. **Clarity Wasm reduces the need**: With Clarity Wasm (see [stacks-core discussion](https://github.com/stacks-network/stacks-core/pull/2926)), only the compiled WASM module is loaded at runtime. Documentation comments only affect deployment cost, not execution cost. This significantly reduces the economic pressure to strip comments.

2. **Breaking change with limited benefit**: Introducing `;;;` would require updates to:
   - The Clarity parser/lexer
   - All syntax highlighters and IDE extensions
   - Developer mental models and habits

   The benefit (easier stripping) doesn't justify this ecosystem-wide change.

3. **Stripping is a build-tool concern**: Build tools like Clarinet can strip `;;` comments before deployment without requiring special syntax. This keeps the language simple while giving developers control.

4. **Backwards compatibility**: Every existing `;;` comment remains valid. Developers can adopt `@` tags incrementally without changing their commenting style.

### Cost Management Strategies

For developers concerned about deployment costs, ClarityDoc provides several strategies:

1. **Off-chain documentation** (`@uri` + `@hash`): Keep verbose documentation off-chain, reference it with a URL, and verify integrity with a hash.

2. **Build-time stripping**: Use `stripDocs()` to remove documentation before deployment while keeping essential tags like `@err` for wallet integration.

3. **Selective documentation**: Only document public-facing functions; skip internal helpers.

The reference implementation (`@secondlayer/clarity-docs`) includes utilities for all these strategies.

## Activation

This SIP is considered activated when:

1. **Reference implementation published**: The `@secondlayer/clarity-docs` npm package provides parsing, validation, and generation tools
2. **Tooling adoption**: At least one of the following adopts ClarityDoc:
   - Clarinet CLI (`clarinet docs` command)
   - Hiro Platform documentation viewer
   - A VS Code extension with hover support
3. **Community feedback**: A 30-day public comment period has completed
4. **Documentation**: The Clarity Book or Hiro docs include ClarityDoc guidance

## Reference Implementations

### @secondlayer/clarity-docs

A TypeScript library providing:

- **Parser**: Extracts structured documentation from Clarity source
- **Validator**: Checks `@param` tags match function arguments, validates tag placement
- **Coverage**: Calculates documentation completeness metrics
- **Generators**: Outputs Markdown and JSON documentation
- **Stripping**: Remove docs before deployment while preserving essential tags

**Installation:**
```bash
npm install @secondlayer/clarity-docs
```

**Basic Usage:**
```typescript
import { extractDocs, generateMarkdown, generateJson, validateDocs } from '@secondlayer/clarity-docs';

// Parse documentation from source
const docs = extractDocs(claritySource);

// Generate Markdown documentation
const markdown = generateMarkdown(docs);

// Generate JSON documentation
const json = generateJson(docs);

// Validate against ABI
const result = validateDocs(docs, contractAbi);
console.log(`Valid: ${result.valid}`);
```

**Error Constants Example:**
```typescript
import { extractDocs, toJson } from '@secondlayer/clarity-docs';

const source = `
;; @contract Token Contract
;; @uri https://docs.example.com/token

;; @err Insufficient balance for transfer
(define-constant ERR_INSUFFICIENT_BALANCE (err u1))

;; @err Transfer amount must be positive
(define-constant ERR_INVALID_AMOUNT (err u2))
`;

const docs = extractDocs(source);
const json = toJson(docs);

// Access error constants for wallet integration
for (const constant of json.constants) {
  if (constant.isError) {
    console.log(`${constant.errorCode}: ${constant.errorDescription}`);
    // Output: u1: Insufficient balance for transfer
    //         u2: Transfer amount must be positive
  }
}

// Access off-chain docs URL
console.log(`Documentation: ${json.header.uri}`);
// Output: Documentation: https://docs.example.com/token
```

**Tag Validation Example:**
```typescript
import { extractDocs, validateDocs, TAG_RULES, isTagValidForContext } from '@secondlayer/clarity-docs';

// Check if a tag is valid for a context
console.log(isTagValidForContext('param', 'public'));    // true
console.log(isTagValidForContext('param', 'constant'));  // false
console.log(isTagValidForContext('err', 'constant'));    // true (error constants)

// Validate docs with tag placement warnings
const docs = extractDocs(source);
const result = validateDocs(docs, abi);

for (const diagnostic of result.diagnostics) {
  if (diagnostic.tag) {
    console.log(`${diagnostic.severity}: ${diagnostic.message}`);
    // Example: warning: Tag '@param' is not typically used on constant definitions
  }
}
```

**Coverage Metrics Example:**
```typescript
import { extractDocs, calculateCoverage } from '@secondlayer/clarity-docs';

const docs = extractDocs(source);
const coverage = calculateCoverage(docs, abi);

console.log(`Function coverage: ${coverage.functionCoverage.toFixed(1)}%`);
console.log(`Map coverage: ${coverage.mapCoverage.toFixed(1)}%`);
console.log(`Variable coverage: ${coverage.variableCoverage.toFixed(1)}%`);
console.log(`Overall coverage: ${coverage.overallCoverage.toFixed(1)}%`);
```

**Stripping Docs for Deployment:**
```typescript
import { stripDocs, estimateStrippingSavings } from '@secondlayer/clarity-docs';

// Keep only @err tags for wallet integration
const minimal = stripDocs(source, { keepErrors: true });

// Remove all documentation
const bare = stripDocs(source, { removeAll: true });

// Keep @err and @desc
const balanced = stripDocs(source, { keepErrors: true, keepDesc: true });

// Estimate byte savings
const savings = estimateStrippingSavings(source, { keepErrors: true });
console.log(`Saved ${savings.savedBytes} bytes (${savings.savingsPercent.toFixed(1)}%)`);
```

**Repository:** https://github.com/ryanwaits/secondlayer

### Future Implementations

- **Clarinet integration**: `clarinet docs` command for generating documentation
- **VS Code extension**: Hover information and documentation previews
- **Documentation site generator**: Static site generation from ClarityDoc comments
- **Wallet SDK**: Error message lookup utilities for transaction UX

## Appendix A: Tag Quick Reference

| Tag | Applies To | Has Argument | Description |
|-----|-----------|--------------|-------------|
| `@contract` | Contract | No | Contract name/title |
| `@author` | Contract | No | Author information |
| `@uri` | Contract | No | Off-chain documentation URL |
| `@hash` | Contract | No | Documentation hash for integrity |
| `@desc` | All | No | Human-readable description |
| `@dev` | All | No | Developer notes |
| `@param` | Functions | Yes (name) | Parameter description |
| `@ok` | Functions | No | Success value description |
| `@err` | Functions, Constants | Yes (code) | Error case description |
| `@post` | Functions | Yes (asset) | Postcondition (asset transfer/mint) |
| `@prints` | Functions | Yes (name) | Print statements triggered |
| `@example` | Functions, Constants | No | Usage example |
| `@key` | Maps | No | Map key description |
| `@value` | Maps | No | Map value description |
| `@version` | All | No | Version information |
| `@deprecated` | All | No | Deprecation notice |
| `@see` | All | No | Cross-reference |
| `@custom:*` | All | No | Custom extension tags |

## Appendix B: Validation Rules

Conforming tools SHOULD implement these validation rules:

| Rule | Severity | Description |
|------|----------|-------------|
| V001 | Error | `@param` name does not match any function argument |
| V002 | Warning | Function argument missing `@param` documentation |
| V003 | Warning | Public/read-only function missing `@desc` |
| V004 | Info | Public/read-only function missing `@ok` |
| V005 | Info | Map missing `@key` or `@value` documentation |
| V006 | Warning | `@deprecated` without replacement suggestion |
| V007 | Warning | Tag used on incompatible definition type |

## Appendix C: Tag Placement Matrix

Tags are validated based on definition context. Using a tag outside its valid context generates a warning:

| Tag | Contract | Function | Constant | Variable | Map | Trait |
|-----|:--------:|:--------:|:--------:|:--------:|:---:|:-----:|
| `@contract` | ✓ | | | | | |
| `@author` | ✓ | | | | | |
| `@uri` | ✓ | | | | | |
| `@hash` | ✓ | | | | | |
| `@implements` | ✓ | | | | | |
| `@desc` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `@dev` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `@version` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `@deprecated` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `@see` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `@param` | | ✓ | | | | |
| `@ok` | | ✓ | | | | |
| `@err` | | ✓ | ✓ | | | |
| `@post` | | ✓ | | | | |
| `@prints` | | ✓ | | | | |
| `@example` | | ✓ | ✓ | | | |
| `@calls` | | ✓ | | | | |
| `@caller` | | ✓ | | | | |
| `@key` | | | | | ✓ | |
| `@value` | | | | | ✓ | |
| `@custom:*` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Appendix D: Off-Chain Documentation

The `@uri` and `@hash` tags support hybrid documentation strategies:

### Use Cases

1. **Localization**: Host translated documentation off-chain
2. **Rich Media**: Link to diagrams, videos, or interactive examples
3. **Cost Reduction**: Keep verbose docs off-chain to reduce deployment costs
4. **Versioning**: Point to versioned documentation sites

### Integrity Verification

When `@hash` is provided, clients SHOULD verify fetched documentation:

```typescript
// Fetch and verify off-chain docs
const response = await fetch(contractDoc.header.uri);
const content = await response.text();
const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
const hashHex = 'sha256:' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');

if (hashHex !== contractDoc.header.docsHash) {
  console.warn('Documentation hash mismatch - content may have changed');
}
```

## Appendix E: Error Constants for Wallet Integration

Error constants with `@err` enable wallets and explorers to display human-readable error messages:

### Contract Definition

```clarity
;; @err Balance too low for transfer
(define-constant ERR_BALANCE_TOO_LOW (err u67))

;; @err Recipient address is invalid
(define-constant ERR_INVALID_RECIPIENT (err u68))
```

### JSON Output

```json
{
  "constants": [
    {
      "name": "ERR_BALANCE_TOO_LOW",
      "type": "constant",
      "isError": true,
      "errorDescription": "Balance too low for transfer",
      "errorCode": "u67"
    },
    {
      "name": "ERR_INVALID_RECIPIENT",
      "type": "constant",
      "isError": true,
      "errorDescription": "Recipient address is invalid",
      "errorCode": "u68"
    }
  ]
}
```

### Wallet Integration

```typescript
// Map error response to human-readable message
function getErrorMessage(errorResponse: string, contractDocs: JsonContractDoc): string {
  // Extract error code from "(err u67)" format
  const match = errorResponse.match(/\(err\s+u(\d+)\)/);
  if (!match) return errorResponse;

  const errorCode = `u${match[1]}`;
  const errorConstant = contractDocs.constants.find(
    c => c.isError && c.errorCode === errorCode
  );

  return errorConstant?.errorDescription || errorResponse;
}

// Usage
const result = await callContract('transfer', args);
if (result.error) {
  const message = getErrorMessage(result.error, contractDocs);
  showError(message); // "Balance too low for transfer" instead of "(err u67)"
}
```

## Appendix F: Documentation Stripping

For cost-sensitive deployments, build tools can strip documentation before deployment.

### Stripping Strategies

| Strategy | Use Case | Keeps |
|----------|----------|-------|
| `removeAll` | Absolute minimum size | Nothing |
| `keepErrors` | Wallet integration | `@err` tags only |
| `keepDesc` + `keepErrors` | Basic docs + errors | `@desc` and `@err` |
| `@uri` + `@hash` | Full docs off-chain | Reference only |

### Reference Implementation

```typescript
import { stripDocs, estimateStrippingSavings } from '@secondlayer/clarity-docs';

// Original contract with full documentation
const source = `
;; @contract Token Contract
;; @author Alice
;; @desc A fungible token with transfer limits
;; @dev Implements SIP-010
;; @uri https://docs.example.com/token
;; @version 1.0.0

;; @err Insufficient balance
(define-constant ERR_INSUFFICIENT_BALANCE (err u1))

;; @err Transfer amount exceeds limit
(define-constant ERR_EXCEEDS_LIMIT (err u2))

;; @desc Transfer tokens between accounts
;; @param amount Number of tokens to transfer
;; @param sender Source account
;; @param recipient Destination account
;; @ok True on successful transfer
;; @err ERR_INSUFFICIENT_BALANCE When sender lacks funds
;; @err ERR_EXCEEDS_LIMIT When amount exceeds daily limit
;; @example (transfer u100 tx-sender 'SP123...)
(define-public (transfer (amount uint) (sender principal) (recipient principal))
  ...)
`;

// Strategy 1: Keep only error constants for wallet UX
const minimal = stripDocs(source, { keepErrors: true });
// Result: Only ;; @err lines remain

// Strategy 2: Remove everything
const bare = stripDocs(source, { removeAll: true });
// Result: No ;; comments remain

// Strategy 3: Keep errors and descriptions
const balanced = stripDocs(source, { keepErrors: true, keepDesc: true });
// Result: @err and @desc lines remain

// Estimate savings
const savings = estimateStrippingSavings(source, { keepErrors: true });
console.log(`Saved ${savings.savedBytes} bytes (${savings.savingsPercent.toFixed(1)}%)`);
```

### Recommended Workflow

1. **Development**: Full documentation with all tags
2. **Testnet**: Full documentation (cost is minimal)
3. **Mainnet**: Strip to `keepErrors: true` or use `@uri` for off-chain docs

### Clarinet Integration (Future)

```toml
# Clarinet.toml
[deployment.mainnet]
strip_docs = true
keep_error_docs = true
```

```bash
# Command line
clarinet deploy --strip-docs --keep-errors
```

## Appendix G: Clarity 4 Asset Restrictions

Clarity 4 introduces built-in functions for programmatic asset restrictions that complement ClarityDoc's `@post` tag:

### New Functions

| Function | Purpose |
|----------|---------|
| `restrict-assets?` | Wrap expressions with asset outflow limits |
| `as-contract?` | Execute as contract with asset allowances |
| `with-stx` | Allow STX outflow up to amount |
| `with-ft` | Allow FT outflow up to amount |
| `with-nft` | Allow specific NFT outflow |
| `with-stacking` | Allow stacking up to amount |

### Relationship to `@post`

The `@post` tag documents *expected* asset movements for human readers and wallets. Clarity 4's `restrict-assets?` *enforces* limits programmatically:

```clarity
;; @desc Swap tokens for STX
;; @param amount Tokens to sell
;; @post token Transfers `amount` tokens to contract
;; @post stx Receives STX from contract (amount varies by rate)
;; @ok STX amount received
(define-public (swap (amount uint))
  (restrict-assets? tx-sender
    ((with-ft .token "my-token" amount))  ;; Enforce: max `amount` tokens leave
    (let ((stx-out (calculate-stx-out amount)))
      (try! (ft-transfer? my-token amount tx-sender (as-contract tx-sender)))
      (try! (as-contract? ((with-stx stx-out))
        (stx-transfer? stx-out tx-sender tx-sender)))
      (ok stx-out))))
```

### Best Practice

- Use `@post` to document intent for humans/wallets
- Use `restrict-assets?` to enforce limits in code
- Both should align—if `@post` says "max 100 STX", code should enforce it
