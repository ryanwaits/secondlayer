import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: ["src/index.ts", "src/types.ts", "src/define.ts", "src/ai.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@ai-sdk/anthropic", "ai", "zod"],
}) as DefineConfigItem;
export default config;
