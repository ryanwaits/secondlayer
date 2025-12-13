# @secondlayer/cli

Generate fully typed contract interfaces, functions, and React hooks for Clarity smart contracts.

## Usage

### 1. Utilize the generated contract interfaces with familiar libraries
```typescript
// Usage with `@stacks/transactions`
import { mega } from './generated/contracts'
import { fetchCallReadOnlyFunction, makeContractCall } from '@stacks/transactions'

await makeContractCall({
  ...mega.callback({
    sender: "SPKPXQ0X3A4D1KZ4XTP1GABJX1N36VW10D02TK9X",
    memo: "Hello world",
  }),
  network: 'mainnet',
})

await fetchCallReadOnlyFunction({
  ...mega.getBalance(),
  network: 'mainnet'
})
```

### 2. Use built-in read/write helpers
```typescript
// Read helpers
const balance = await mega.read.getBalance() // {type: 'uint', value: 42000000n}

// Write helpers
const result = await mega.write.transfer(
  {
    amount: 10000n,
    recipient: "SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335",
  },
  {
    senderKey: "b244296d5907de9864c0b0d51f98a13c52890be0404e83f273144cd5b9960eed01",
  }
);
```

### 3. React integration
```typescript
import { useBnsV2Transfer } from './generated/hooks'

function App() {
  const { transfer, isRequestPending } = useBnsV2Transfer()
  
  return (
    <button 
      onClick={() => transfer({
        id: 1n,
        owner: 'SP...',
        recipient: 'SP...'
      })}
      disabled={isRequestPending}
    >
      Transfer
    </button>
  )
}
```

## Installation

> **Note:** This package is not yet published to npm. For now, you can install it locally:

```bash
bun add -g @secondlayer/cli
```
## Setup

To create a `stacks.config.ts` file, run `secondlayer init` in your Clarinet project:

```bash
secondlayer init
```

```typescript
// stacks.config.ts
import { defineConfig } from '@secondlayer/cli'
import { clarinet } from '@secondlayer/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [clarinet()],
})
```

Run `secondlayer generate` to create fully type-safe interfaces for your contracts.

```bash
secondlayer generate
✔ Generation complete for 2 contracts
📄 ./src/generated/contracts.ts
```

## Quick Start (No Config)

Generate interfaces directly from local files or deployed contracts without a config file:

```bash
# Local .clar files
secondlayer generate ./contracts/token.clar -o ./src/generated.ts

# Glob patterns
secondlayer generate "./contracts/*.clar" -o ./src/generated.ts

# Deployed contracts (network auto-detected from address)
secondlayer generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./src/generated.ts

# Mix local and deployed
secondlayer generate ./local.clar SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7.token -o ./src/generated.ts

# With API key (for rate limiting)
secondlayer generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./out.ts --api-key YOUR_KEY

# Or use environment variable
HIRO_API_KEY=YOUR_KEY secondlayer generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./out.ts
```

Network is inferred from address prefix:
- `SP` / `SM` → mainnet
- `ST` / `SN` → testnet

## Advanced

### Plugins

```typescript
import { defineConfig } from '@secondlayer/cli'
import { clarinet, actions, react, testing } from '@secondlayer/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    clarinet(),    // Generate contract interfaces from local Clarinet project
    actions(),     // Add read/write helper functions
    react(),       // Generate React hooks
    testing(),     // Generate Clarinet SDK test helpers
  ],
})
```

### Testing Plugin

Generate type-safe helpers for Clarinet SDK unit tests. No more manual Clarity value conversions or remembering function signatures.

```typescript
// stacks.config.ts
import { defineConfig } from '@secondlayer/cli'
import { clarinet, testing } from '@secondlayer/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    clarinet(),
    testing({
      out: './tests/helpers.ts',  // Output path (default: ./src/generated/testing.ts)
      includePrivate: true,       // Include private function helpers
    }),
  ],
})
```

#### Usage

```typescript
import { describe, it, expect } from 'vitest';
import { Cl } from '@hirosystems/clarinet-sdk';
import { getToken, getContracts } from './helpers';

describe('Token Contract', () => {
  const simnet = await initSimnet();
  const { token } = getContracts(simnet);
  // Or: const token = getToken(simnet);

  it('calls public functions', () => {
    const result = token.transfer(
      { amount: 1000n, sender: 'ST1...', recipient: 'ST2...' },
      'wallet_1'  // Caller (resolved from accounts or used as-is)
    );
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it('calls read-only functions', () => {
    const result = token.getBalance({ account: 'ST1...' });
    expect(result.result).toBeOk(Cl.uint(1000n));
  });

  it('reads data variables', () => {
    const totalSupply = token.vars.totalSupply();
    expect(totalSupply).toEqual(Cl.uint(1000000n));
  });

  it('reads map entries', () => {
    // Simple key
    const balance = token.maps.balances('ST1...');
    expect(balance).toEqual(Cl.some(Cl.uint(500n)));

    // Composite key (tuple)
    const allowance = token.maps.allowances({
      owner: 'ST1...',
      spender: 'ST2...'
    });
    expect(allowance).toEqual(Cl.some(Cl.uint(100n)));
  });
});
```

#### Generated API

| Helper | Description |
|--------|-------------|
| `fn(args, caller)` | Call public functions |
| `fn(args)` | Call read-only functions |
| `fn(args, caller)` | Call private functions (with `includePrivate: true`) |
| `vars.varName()` | Read data variables via `getDataVar` |
| `maps.mapName(key)` | Read map entries via `getMapEntry` with typed keys |

## Future Enhancements

#### Typed event matchers for testing plugin

Add type-safe event assertion helpers based on contract print events.

```typescript
// Future API
const result = token.transfer({ ... }, 'wallet_1');

// Type-safe event matching
token.events.expectTransfer(result.events, {
  sender: 'ST1...',
  recipient: 'ST2...',
  amount: 1000n
});
```

#### Converting responses using `cvToValue`

Currently, when calling read-only functions or receiving blockchain responses, developers must manually extract values from Clarity value objects that include type metadata (e.g., `{ type: "uint", value: 42000n }`). This requires repetitive boilerplate code to access the actual values.

_Solution:_ Provide automatic Clarity value conversion with full TypeScript type inference, extracting raw values while preserving complete type safety.

```typescript
import { daoContract } from './generated/contracts';

// Before
const result = await daoContract.read.getProposal(proposalId);
// Returns complex nested structure:
// {
//   type: "tuple",
//   value: {
//     id: { type: "uint", value: 1n },
//     proposer: { type: "principal", value: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7" },
//     title: { type: "string-utf8", value: "Increase Treasury Allocation" },
//     votesFor: { type: "uint", value: 150000n },
//     votesAgainst: { type: "uint", value: 50000n },
//     startBlock: { type: "uint", value: 120500n },
//     endBlock: { type: "uint", value: 125500n },
//     executed: { type: "bool", value: false }
//   }
// }

// Tedious extraction needed:
return {
  id: result.value.id.value,
  proposer: result.value.proposer.value,
  title: result.value.title.value,
  votesFor: result.value.votesFor.value,
  votesAgainst: result.value.votesAgainst.value,
  startBlock: result.value.startBlock.value,
  endBlock: result.value.endBlock.value,
  executed: result.value.executed.value
};

// After
const proposal = await daoContract.read.getProposal(proposalId);
// Returns clean TypeScript object directly:
// {
//   id: 1n,
//   proposer: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
//   title: "Increase Treasury Allocation",
//   votesFor: 150000n,
//   votesAgainst: 50000n,
//   startBlock: 120500n,
//   endBlock: 125500n,
//   executed: false
// }

// Full type safety and IntelliSense:
console.log(proposal.endBlock); // ✅ TypeScript knows this is bigint
console.log(proposal.title);     // ✅ TypeScript knows this is string
console.log(proposal.executed);  // ✅ TypeScript knows this is boolean

return proposal;
```

#### More hooks

## License

MIT