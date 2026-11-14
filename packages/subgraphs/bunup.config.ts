import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	// bunup starts its own dist/ wipe without awaiting it, so the wipe races
	// the build's writes (ENOENT/EINVAL mid-build, or an empty dist/). The
	// build script wipes dist/ once before bunup runs instead.
	clean: false,
	entry: [
		"src/index.ts",
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
