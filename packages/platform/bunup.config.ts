import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/db/queries/accounts.ts",
		"src/db/queries/account-spend-caps.ts",
		"src/db/queries/account-credits.ts",
		"src/db/queries/archive-fetches.ts",
		"src/db/queries/usage-ledger.ts",
		"src/billing/prices.ts",
		"src/billing/meter.ts",
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
