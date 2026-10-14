/**
 * Generates the subgraphs package reference for the docs site from this
 * package's own TypeScript source, via openpkg.
 *
 * Run from packages/subgraphs:  bun run openpkg
 *
 * The package has three public entries (`.`, `./testing`, `./verify`); openpkg
 * reads each and the specs are merged. The walk, type rendering and output
 * contract live in scripts/reference.
 */
import { extractReference } from "../../../scripts/reference/extract";

await extractReference({
	package: "packages/subgraphs",
	entry: ["src/index.ts", "src/testing/index.ts", "src/verify/index.ts"],
	docsBase: "/docs/subgraphs-reference",
	out: "apps/web/src/generated/reference/subgraphs",
	groups: [
		{
			slug: "define",
			title: "Define a subgraph",
			files: /^src\/(define|validate|print-schema|types|events)\.ts$/,
		},
		{
			slug: "context",
			title: "Handler context",
			members: { type: "TypedSubgraphContext", root: "ctx" },
			files: /^src\/infer\.ts$/,
		},
		{
			slug: "chain-read",
			title: "Contract reads",
			files: /^src\/runtime\/chain-read\.ts$/,
		},
		{
			slug: "schema",
			title: "Schema and SQL",
			files: /^src\/schema\//,
			names: ["pgSchemaName"],
		},
		{
			slug: "block-sources",
			title: "Block sources",
			files: /^src\/runtime\/block-source\.ts$/,
		},
		{
			slug: "verification",
			title: "Verification",
			files: /^src\/(verification\.ts|runtime\/(realm|print-validate)\.ts)$/,
		},
		{
			slug: "replay",
			title: "Replay",
			from: "@secondlayer/subgraphs/verify",
			files: /^src\/verify\//,
		},
		{
			slug: "testing",
			title: "Testing",
			from: "@secondlayer/subgraphs/testing",
			files: /^src\/testing\//,
			names: ["buildEventPayload"],
		},
	],
});
