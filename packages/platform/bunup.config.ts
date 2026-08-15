import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/db/queries/accounts.ts",
		"src/db/queries/account-spend-caps.ts",
		"src/db/queries/account-credits.ts",
		"src/schemas/accounts.ts",
	],
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/shared", "kysely", "zod"],
}) as DefineConfigItem;
export default config;
