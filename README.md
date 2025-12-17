# @secondlayer/cli

Type-safe contract interfaces, functions, and React hooks for Clarity smart contracts.

## Install

```bash
bun add -g @secondlayer/cli
```

## Quick Start

Generate from local files or deployed contracts—no config required:

```bash
# Local .clar files
secondlayer generate ./contracts/token.clar -o ./src/generated.ts

# Deployed contracts (network inferred from address)
secondlayer generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./src/generated.ts

# Glob patterns
secondlayer generate "./contracts/*.clar" -o ./src/generated.ts
```

## With Config

```bash
secondlayer init  # creates secondlayer.config.ts
secondlayer generate
```

```typescript
// secondlayer.config.ts
import { defineConfig } from '@secondlayer/cli'
import { clarinet, actions, react } from '@secondlayer/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    clarinet(),  // parse local Clarinet project
    actions(),   // add read/write helpers
    react(),     // generate React hooks
  ],
})
```

## Usage

### Contract Calls

```typescript
import { token } from './generated/contracts'
import { makeContractCall, fetchCallReadOnlyFunction } from '@stacks/transactions'

// works with @stacks/transactions directly
await makeContractCall({
  ...token.transfer({ amount: 100n, recipient: "SP..." }),
  network: 'mainnet',
})

await fetchCallReadOnlyFunction({
  ...token.getBalance({ account: "SP..." }),
  network: 'mainnet',
})
```

### Read/Write Helpers

Requires `actions()` plugin:

```typescript
// read-only
const balance = await token.read.getBalance({ account: "SP..." })

// write (signs + broadcasts)
await token.write.transfer(
  { amount: 100n, recipient: "SP..." },
  { senderKey: "..." }
)
```

### Contract State

Access maps, variables, constants directly:

```typescript
// maps
const balance = await token.maps.balances.get("SP...")

// variables
const supply = await token.vars.totalSupply.get()

// constants
const max = await token.constants.maxSupply.get()

// network override
const devBalance = await token.maps.balances.get("SP...", { network: 'devnet' })
```

### React Hooks

Requires `react()` plugin:

```typescript
import { useTokenTransfer, useTokenBalances, useTokenTotalSupply } from './generated/hooks'

function App() {
  const { transfer, isRequestPending } = useTokenTransfer()
  const { data: balance } = useTokenBalances("SP...")
  const { data: supply } = useTokenTotalSupply()

  return (
    <button onClick={() => transfer({ amount: 100n, recipient: "SP..." })} disabled={isRequestPending}>
      Transfer
    </button>
  )
}
```

### Testing Helpers

Requires `testing()` plugin:

```typescript
import { getContracts } from './helpers'

const simnet = await initSimnet()
const { token } = getContracts(simnet)

// call functions
const result = token.transfer({ amount: 100n, recipient: "ST..." }, "wallet_1")
expect(result.result).toBeOk(Cl.bool(true))

// read state
const supply = token.vars.totalSupply()
const balance = token.maps.balances("ST...")
```

## Plugins

| Plugin | Description |
|--------|-------------|
| `clarinet()` | Parse local Clarinet project |
| `actions()` | Add `read`/`write` helpers |
| `react()` | Generate React hooks |
| `testing()` | Generate Clarinet SDK test helpers |

## Network Inference

Address prefix determines network:
- `SP`/`SM` → mainnet
- `ST`/`SN` → testnet

## License

MIT
