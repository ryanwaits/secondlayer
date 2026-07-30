import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/index.ts",
		"src/subgraphs/index.ts",
		"src/streams/index.ts",
		"src/streams/rows.ts",
		"src/x402.ts",
		"src/sinks/kysely.ts",
	],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/shared", "@secondlayer/stacks", "kysely"],
}) as DefineConfigItem;
export default config;
