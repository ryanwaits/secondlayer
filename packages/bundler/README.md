# @secondlayer/bundler

Bundles a [Secondlayer](https://github.com/ryanwaits/secondlayer) subgraph definition into a single deployable artifact. It compiles a `defineSubgraph(...)` TypeScript module (and its imports) with esbuild, then extracts the subgraph's `name`, `sources`, `schema`, and handler code ready for deployment.

Used internally by [`@secondlayer/cli`](https://www.npmjs.com/package/@secondlayer/cli) and [`@secondlayer/mcp`](https://www.npmjs.com/package/@secondlayer/mcp) when you run `sl subgraphs deploy`.

## Install

```bash
bun add @secondlayer/bundler
```

## Usage

```ts
import { bundleSubgraphCode } from "@secondlayer/bundler";

const code = await Bun.file("subgraphs/my-contract.ts").text();
const bundle = await bundleSubgraphCode(code);

bundle.name;        // subgraph name
bundle.sources;     // event filters, keyed by source name
bundle.schema;      // declared table schema
bundle.handlerCode; // bundled handler module (string)
```

Bundles larger than `SUBGRAPH_BUNDLE_MAX_BYTES` (4 MB) throw `BundleSizeError`.

## License

MIT
