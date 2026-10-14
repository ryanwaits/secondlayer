/**
 * Generates the verify package reference for the docs site from this
 * package's own TypeScript source, via openpkg.
 *
 * Run from packages/verify:  bun run openpkg
 *
 * The walk, type rendering and output contract live in scripts/reference.
 */
import { extractReference } from "../../../scripts/reference/extract";

await extractReference({
	package: "packages/verify",
	entry: "src/index.ts",
	docsBase: "/docs/verify-reference",
	out: "apps/web/src/generated/reference/verify",
	groups: [
		{
			slug: "verify-block",
			title: "Verify a block",
			files: /^src\/(verify-block|state|txs|links)\.ts$/,
		},
		{
			slug: "sources",
			title: "Proof sources",
			files: /^src\/source\.ts$/,
		},
		{
			slug: "proofs",
			title: "Proofs and headers",
			files: /^src\/(marf|header|witness|signers|burn|keys|bytes)\.ts$/,
		},
		{
			slug: "bitcoin",
			title: "Bitcoin headers",
			files: /^src\/(bitcoin\/chain|checkpoint|checkpoint-mainnet)\.ts$/,
		},
	],
});
