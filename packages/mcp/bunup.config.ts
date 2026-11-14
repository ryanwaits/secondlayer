import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	// bunup starts its own dist/ wipe without awaiting it, so the wipe races
	// the build's writes (ENOENT/EINVAL mid-build, or an empty dist/). The
	// build script wipes dist/ once before bunup runs instead.
	clean: false,
	entry: ["src/index.ts", "src/bin.ts", "src/bin-http.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: [
		"@modelcontextprotocol/sdk",
		"@secondlayer/sdk",
		"@secondlayer/stacks",
		"@secondlayer/subgraphs",
		"esbuild",
		"zod",
	],
}) as DefineConfigItem;
export default config;
