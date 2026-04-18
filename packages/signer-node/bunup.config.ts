import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	name: "signer-node",
	entry: ["src/index.ts", "src/policy.ts"],
	format: ["esm"],
	dts: true,
	splitting: false,
	sourcemap: "linked",
	minify: false,
}) as DefineConfigItem;

export default config;
