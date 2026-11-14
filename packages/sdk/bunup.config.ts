import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	// bunup starts its own dist/ wipe without awaiting it, so the wipe races
	// the build's writes (ENOENT/EINVAL mid-build, or an empty dist/). The
	// build script wipes dist/ once before bunup runs instead.
	clean: false,
	entry: [
		"src/index.ts",
		"src/subgraphs/index.ts",
		"src/streams/index.ts",
		"src/streams/rows.ts",
		"src/sinks/core.ts",
		"src/sinks/kysely.ts",
		"src/sinks/drizzle.ts",
		"src/sinks/bun-sqlite.ts",
		"src/sinks/testing.ts",
		"src/webhooks/doctor.ts",
		"src/webhooks/triggers.ts",
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
