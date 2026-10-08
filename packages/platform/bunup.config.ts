import { type DefineConfigItem, defineConfig } from "bunup";

const config: DefineConfigItem = defineConfig({
	entry: [
		"src/db/queries/accounts.ts",
		"src/db/queries/account-spend-caps.ts",
		"src/db/queries/account-credits.ts",
		"src/db/queries/archive-fetches.ts",
		"src/db/queries/usage-ledger.ts",
		"src/db/queries/account-balance-alerts.ts",
		"src/db/queries/api-failed-requests.ts",
		"src/billing/prices.ts",
		"src/billing/meter.ts",
		"src/billing/runway.ts",
		"src/schemas/accounts.ts",
	],
	// Explicit source root: Bun.build's inferred common-ancestor flips to the
	// package dir once the entry list grows past ~8, nesting output under
	// dist/src and breaking every exports subpath.
	sourceBase: "src",
	format: ["esm"],
	dts: true,
	sourcemap: "linked",
	minify: false,
	splitting: false,
	external: ["@secondlayer/shared", "kysely", "zod"],
}) as DefineConfigItem;
export default config;
