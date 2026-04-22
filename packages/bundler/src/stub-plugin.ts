import type { Plugin } from "esbuild";

/**
 * Intercepts bare imports of `@secondlayer/subgraphs` inside user-supplied
 * TypeScript source, replacing them with a tiny inline stub.
 *
 * The package exposes `defineSubgraph` — a pure identity function. User
 * source only imports that plus types (erased at compile). Stubbing avoids
 * esbuild filesystem resolution (which breaks in Vercel serverless where
 * `process.cwd()` has no node_modules) and avoids pulling transitive
 * dependencies into the bundled handler.
 */
export function stubPackagesPlugin(): Plugin {
	return {
		name: "secondlayer-stub-packages",
		setup(build) {
			const filter = /^@secondlayer\/subgraphs$/;

			build.onResolve({ filter }, (args) => ({
				path: args.path,
				namespace: "secondlayer-stub",
			}));

			build.onLoad({ filter: /.*/, namespace: "secondlayer-stub" }, () => ({
				contents: "export function defineSubgraph(def) { return def; }\n",
				loader: "js",
			}));
		},
	};
}
