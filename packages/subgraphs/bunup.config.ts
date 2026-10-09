import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/index.ts",
		"src/types.ts",
		"src/validate.ts",
		"src/verification.ts",
		"src/schema/index.ts",
		"src/runtime/replay.ts",
		"src/runtime/emitter.ts",
		"src/testing/index.ts",
		"src/verify/index.ts",
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
		"@secondlayer/verify",
		"esbuild",
		"kysely",
		"zod",
	],
}) as DefineConfigItem;
export default config;
