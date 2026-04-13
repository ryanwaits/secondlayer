import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/subgraphs", "@secondlayer/workflows"],
}) as DefineConfigItem;
export default config;
