import { type DefineConfigItem, defineConfig } from "bunup";

// Every entry sets `clean: false` and the build script wipes `dist/` once up
// front. bunup runs these builds in PARALLEL and the outDirs are nested — the
// root build owns `dist/`, which physically contains `dist/src/connect` and
// `dist/src/tools`, which in turn contain `.../walletconnect` and `.../btc`.
// With per-build cleaning, a parent can wipe a child's directory mid-write:
// CI failed with `ENOENT: mkdir dist/src/connect/walletconnect` doing exactly
// that. Cleaning once, before anything writes, removes the race by
// construction rather than by winning it.
const config: DefineConfigItem[] = defineConfig([
	{
		name: "stacks",
		clean: false,
		entry: [
			"src/index.ts",
			"src/accounts/index.ts",
			"src/chains/index.ts",
			"src/clarity/index.ts",
			"src/actions/index.ts",
			"src/postconditions/index.ts",
			"src/transactions/index.ts",
			"src/utils/index.ts",
			"src/bns/index.ts",
			"src/bitcoin/index.ts",
			"src/pox/index.ts",
			"src/pox5/index.ts",
			"src/sbtc/index.ts",
			"src/stackingdao/index.ts",
			"src/subscriptions/index.ts",
			"src/filters/index.ts",
		],
		format: ["esm", "cjs"],
		dts: true,
		splitting: true,
		sourcemap: "linked",
		minify: false,
	},
	{
		name: "connect",
		clean: false,
		entry: ["src/connect/index.ts"],
		outDir: "dist/src/connect",
		format: ["esm", "cjs"],
		dts: true,
		target: "browser",
		splitting: false,
		sourcemap: "linked",
		minify: false,
	},
	{
		name: "walletconnect",
		clean: false,
		entry: ["src/connect/walletconnect/index.ts"],
		outDir: "dist/src/connect/walletconnect",
		format: ["esm", "cjs"],
		dts: true,
		target: "browser",
		splitting: false,
		sourcemap: "linked",
		minify: false,
	},
	// `ai` and `zod` are optional peers: the two tools entries are the only
	// importers, and they stay external so the root entry never pulls them.
	{
		name: "tools",
		clean: false,
		entry: ["src/tools/index.ts"],
		outDir: "dist/src/tools",
		format: ["esm", "cjs"],
		dts: true,
		splitting: false,
		sourcemap: "linked",
		minify: false,
		external: ["ai", "zod"],
	},
	{
		name: "tools-btc",
		clean: false,
		entry: ["src/tools/btc/index.ts"],
		outDir: "dist/src/tools/btc",
		format: ["esm", "cjs"],
		dts: true,
		splitting: false,
		sourcemap: "linked",
		minify: false,
		external: ["ai", "zod"],
	},
	{
		name: "simnet",
		clean: false,
		entry: ["src/simnet/index.ts"],
		outDir: "dist/src/simnet",
		format: ["esm", "cjs"],
		dts: true,
		splitting: false,
		sourcemap: "linked",
		minify: false,
		external: ["@stacks/clarinet-sdk", "@stacks/transactions"],
	},
]) as DefineConfigItem[];
export default config;
