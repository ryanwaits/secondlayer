/**
 * Packages bunup treats as external — never bundled into `dist/`, always
 * resolved from `node_modules` at runtime. Single source of truth for
 * `bunup.config.ts` and for `tests/build-externals.test.ts`, which asserts
 * that any of these NOT in `dependencies` (only dev/peer/optional) never
 * shows up as a top-level static import in the built output.
 *
 * That exact class of bug shipped in 16.0.0–16.3.0: `@stacks/clarinet-sdk`
 * is an optional peer, but a static `import { initSimnet } from
 * "@stacks/clarinet-sdk"` in plugins/clarinet/index.ts became a top-level
 * static import in dist/cli.js (bunup's `splitting: false` keeps externals
 * as real ESM imports), so every fresh install crashed before running any
 * command, even `--version`, when the optional peer wasn't present.
 */
export const BUNDLER_EXTERNALS = [
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
] as const;
