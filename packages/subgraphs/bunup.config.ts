import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/index.ts",
		"src/types.ts",
		"src/validate.ts",
		"src/schema/index.ts",
		"src/runtime/replay.ts",
		"src/runtime/emitter.ts",
		"src/testing/index.ts",
	],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/shared", "kysely", "zod"],
}) as DefineConfigItem;
export default config;
