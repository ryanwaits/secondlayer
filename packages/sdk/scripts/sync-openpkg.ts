/**
 * Generates the SDK reference for the docs site from this package's own
 * TypeScript source, via openpkg.
 *
 * Run from packages/sdk:  bun run openpkg
 *
 * The walk, type rendering and output contract live in scripts/reference;
 * this file is only the SDK's shape.
 */
import { extractReference } from "../../../scripts/reference/extract";

await extractReference({
	package: "packages/sdk",
	entry: "src/index.ts",
	client: "SecondLayer",
	variable: "sl",
	docsBase: "/docs/sdk-reference",
	out: "apps/web/src/generated/reference/sdk",
	variant: { key: "chain", default: "stacks" },
	errorBase: "SecondLayerError",
	surfaces: [
		{ slug: "streams", title: "Streams", member: "streams" },
		{ slug: "index", title: "Index", member: "index" },
		{ slug: "subgraphs", title: "Subgraphs", member: "subgraphs" },
		{ slug: "webhooks", title: "Webhooks", member: "webhooks" },
		{ slug: "archive", title: "Archive", member: "archive" },
		{ slug: "contracts", title: "Contracts", member: "contracts" },
		{ slug: "instance", title: "Instance", member: "instance" },
		{
			slug: "client",
			title: "Client",
			only: ["batch", "context"],
			withConstructor: true,
		},
	],
});
