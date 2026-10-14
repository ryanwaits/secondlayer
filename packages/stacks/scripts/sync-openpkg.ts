/**
 * Generates the `@secondlayer/stacks/filters` reference for the docs site from
 * the package's own TypeScript source, via openpkg.
 *
 * Run from packages/stacks:  bun run openpkg
 *
 * Only the filters entry is documented here; the rest of the package has its
 * own site. The walk, type rendering and output contract live in
 * scripts/reference.
 */
import { extractReference } from "../../../scripts/reference/extract";

await extractReference({
	package: "packages/stacks",
	entry: "src/filters/index.ts",
	docsBase: "/docs/filters-reference",
	out: "apps/web/src/generated/reference/filters",
	groups: [
		{
			slug: "builders",
			title: "Build a filter",
			from: "@secondlayer/stacks/filters",
			files: /^src\/filters\/factories\.ts$/,
		},
		{
			slug: "identifiers",
			title: "Identifiers",
			from: "@secondlayer/stacks/filters",
			files: /^src\/filters\/validate\.ts$/,
		},
		{
			slug: "event-types",
			title: "Event types and specs",
			from: "@secondlayer/stacks/filters",
			files: /^src\/filters\/(event-types|types)\.ts$/,
		},
	],
});
