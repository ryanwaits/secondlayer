import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	// bunup starts its own dist/ wipe without awaiting it, so the wipe races
	// the build's writes (ENOENT/EINVAL mid-build, or an empty dist/). The
	// build script wipes dist/ once before bunup runs instead.
	clean: false,
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/stacks", "@secondlayer/subgraphs"],
}) as DefineConfigItem;
export default config;
