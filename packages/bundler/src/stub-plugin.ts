import type { Plugin } from "esbuild";

/**
 * Intercepts bare imports of `@secondlayer/workflows` and `@secondlayer/subgraphs`
 * inside user-supplied TypeScript source, replacing them with tiny inline stubs.
 *
 * Both packages expose `defineX` helpers that are pure identity functions — the
 * user's source only imports those and their type siblings (erased at compile
 * time). By stubbing the packages we:
 *   1. Avoid esbuild filesystem resolution, which breaks when the bundler runs
 *      inside a Vercel serverless function where `process.cwd()` has no access
 *      to the repo's node_modules.
 *   2. Avoid pulling transitive dependencies (zod, kysely, …) into the bundled
 *      handler, which would balloon the output and push `import(dataUri)` past
 *      the NameTooLong limit on strict runtimes.
 *
 * The resulting bundle is self-contained — downstream file-path imports in the
 * workflow-runner / subgraph runtime provide the real packages.
 */
export function stubPackagesPlugin(): Plugin {
	return {
		name: "secondlayer-stub-packages",
		setup(build) {
			const filter = /^@secondlayer\/(workflows|subgraphs)$/;

			build.onResolve({ filter }, (args) => ({
				path: args.path,
				namespace: "secondlayer-stub",
			}));

			build.onLoad(
				{ filter: /.*/, namespace: "secondlayer-stub" },
				(args) => {
					// Both packages only need a runtime `define*` identity function.
					// Types are compile-time and erased; no other runtime exports are
					// referenced from user source.
					const exportName =
						args.path === "@secondlayer/subgraphs"
							? "defineSubgraph"
							: "defineWorkflow";
					return {
						contents: `export function ${exportName}(def) { return def; }\n`,
						loader: "js",
					};
				},
			);
		},
	};
}
