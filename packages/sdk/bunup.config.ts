import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: ["src/index.ts", "src/streams/index.ts", "src/subgraphs/index.ts", "src/marketplace/index.ts", "src/workflows/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/shared", "@secondlayer/workflows"],
}) as DefineConfigItem;
export default config;
