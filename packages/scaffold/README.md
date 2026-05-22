# @secondlayer/scaffold

Generates a [Secondlayer](https://github.com/ryanwaits/secondlayer) subgraph definition from a Clarity contract ABI. Given a contract's public functions and event maps, it emits a ready-to-edit `defineSubgraph(...)` TypeScript module with inferred table schemas.

Powers `sl subgraphs scaffold <contract>` in [`@secondlayer/cli`](https://www.npmjs.com/package/@secondlayer/cli) and the scaffold tool in [`@secondlayer/mcp`](https://www.npmjs.com/package/@secondlayer/mcp).

## Install

```bash
bun add @secondlayer/scaffold
```

## Usage

```ts
import {
  generateSubgraphCode,
  type AbiFunction,
  type AbiMap,
} from "@secondlayer/scaffold";

const code = generateSubgraphCode(
  "SP1234ABCD.my-contract", // contractId
  functions,                // readonly AbiFunction[] — public functions to index
  "my-subgraph",            // optional name (defaults to the contract name)
  events,                   // optional readonly AbiMap[] — print/event maps to index
);

await Bun.write("subgraphs/my-contract.ts", code);
```

`code` is a formatted `defineSubgraph(...)` module. Only `public` functions and declared events produce tables.

## License

MIT
