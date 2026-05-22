# @secondlayer/clarity-docs

**ClarityDoc** — a documentation-comment standard and toolkit for [Clarity](https://docs.stacks.co/clarity) smart contracts. Parse `;;` doc comments out of a contract, validate coverage against the contract ABI, and generate Markdown or JSON API docs.

Part of the [Secondlayer](https://github.com/ryanwaits/secondlayer) toolchain.

## Install

```bash
bun add @secondlayer/clarity-docs
```

## Usage

```ts
import {
  extractDocsFromFile,
  validateDocs,
  generateMarkdown,
} from "@secondlayer/clarity-docs";

// Parse ClarityDoc comments out of a contract
const doc = await extractDocsFromFile("contracts/my-token.clar");

// Surface missing or malformed docs
const result = validateDocs(doc);

// Render Markdown API docs
await Bun.write("docs/my-token.md", generateMarkdown(doc));
```

Also available:

- `calculateCoverage(doc, abi)` — doc-coverage metrics against the contract ABI.
- `generateJson(doc)` / `toJson(doc)` — machine-readable output.
- `stripDocs(source)` — remove doc comments before deploying a contract on-chain (`estimateStrippingSavings` previews the byte savings).
- Low-level parser access via `tokenize`, `parseDefine`, `extractDocs`.

## License

MIT
