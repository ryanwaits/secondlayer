import { type DefineConfigItem, defineConfig } from "bunup";

const sharedConfig = {
	splitting: false,
	sourcemap: "linked" as const,
	minify: false,
	external: [
		"esbuild",
		"@biomejs/js-api",
		"@biomejs/wasm-nodejs",
		"@stacks/clarinet-sdk",
		"@secondlayer/clarity-types",
		// OpenTUI's core is a native (Zig) addon loaded from node_modules at
		// runtime — bundling it would break the addon's own path resolution.
		// React stays alongside it so both packages share one instance instead
		// of `secondlayer setup` bundling a second copy.
		"@opentui/core",
		"@opentui/react",
		"react",
	],
	noExternal: ["chalk", "commander", "fast-glob", "got", "execa"],
	shims: true,
	target: "node" as const,
};

const config: DefineConfigItem | DefineConfigItem[] = defineConfig({
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
