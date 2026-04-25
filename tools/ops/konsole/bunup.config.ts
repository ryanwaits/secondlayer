import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	external: ["kysely", "kysely-postgres-js", "postgres", "pluralize"],
}) as DefineConfigItem;
export default config;
