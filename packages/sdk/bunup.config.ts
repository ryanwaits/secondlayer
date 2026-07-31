import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/index.ts",
		"src/subgraphs/index.ts",
		"src/streams/index.ts",
		"src/streams/rows.ts",
		"src/x402.ts",
		"src/sinks/core.ts",
		"src/sinks/kysely.ts",
		"src/sinks/drizzle.ts",
		"src/sinks/bun-sqlite.ts",
		"src/sinks/testing.ts",
	],
	// Explicit source root: Bun.build's inferred common-ancestor flips to the
	// package dir once the entry list grows past ~8, nesting output under
	// dist/src and breaking every exports subpath.
	sourceBase: "src",
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: [
		"@secondlayer/shared",
		"@secondlayer/stacks",
		"kysely",
		"drizzle-orm",
		"bun:sqlite",
	],
}) as DefineConfigItem;
export default config;
