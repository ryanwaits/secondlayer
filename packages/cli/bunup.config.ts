import { type DefineConfigItem, defineConfig } from "bunup";
import { BUNDLER_EXTERNALS } from "./src/build-externals";

const sharedConfig = {
	splitting: false,
	sourcemap: "linked" as const,
	minify: false,
	external: [...BUNDLER_EXTERNALS],
	noExternal: ["chalk", "commander", "fast-glob", "got", "execa"],
	shims: true,
	target: "node" as const,
};

const config: DefineConfigItem | DefineConfigItem[] = defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: true,
	...sharedConfig,
});
export default config;
