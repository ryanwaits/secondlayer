import { type DefineConfigItem, defineConfig } from "bunup";

const sharedConfig = {
	splitting: false,
	sourcemap: "linked" as const,
	minify: false,
	external: [
		"esbuild",
		"@biomejs/js-api",
		"@biomejs/wasm-nodejs",
		"@hirosystems/clarinet-sdk",
		"@secondlayer/clarity-types",
	],
	noExternal: ["chalk", "commander", "fast-glob", "got", "execa"],
	shims: true,
	target: "node" as const,
};

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/index.ts",
		"src/cli.ts",
		"src/plugins/index.ts",
		"src/core/plugin-manager.ts",
	],
	format: ["esm"],
	dts: true,
	...sharedConfig,
});
export default config;
