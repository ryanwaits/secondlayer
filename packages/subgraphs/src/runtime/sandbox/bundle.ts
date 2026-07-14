// f071 Stage 2a — host-side (trusted) bundling of a subgraph's `handler_code`
// with a locked-down module resolver, productionizing
// `spike/f060/d2-worker/bundle.ts` (kept in place as the spike's own
// reference/benchmark — this is a separate, hardened copy, not an import of
// the spike file).
//
// This is the sandbox-path analogue of today's `handler_code` → disk →
// `import()` flow (`processor.ts`'s `loadSubgraphDefinition`, writes
// `sg.handler_code` to disk then dynamically imports it). Instead of writing
// to disk and letting Bun's normal resolver run, this bundles the handler
// source with esbuild + a resolver plugin that blocks every import except
// the handler's own relative graph, producing a single dependency-free ESM
// string to hand into the worker's `init` message (see `worker-entry.ts`).
//
// `platform: "neutral"` means esbuild does NOT resolve node builtins against
// the host automatically — every non-relative specifier must be explicitly
// handled by a plugin or bundling fails closed (an unrecognized import form
// this plugin doesn't intercept fails the BUILD, not silently passes through
// at runtime). Same deny-list shape as the existing production stub-plugin
// (`packages/bundler/src/stub-plugin.ts`, documented by the f049 spike).
import esbuild, { type Plugin } from "esbuild";

/** Bare specifiers a sandboxed handler is allowed to reference. Empty on
 *  purpose — handlers get everything they need through the injected `ctx`
 *  global (see `worker-ctx.ts`); no import should ever be necessary. */
const ALLOWED_BARE_SPECIFIERS = new Set<string>();

export class SandboxLockdownError extends Error {
	constructor(specifier: string) {
		super(
			`subgraph sandbox: import of "${specifier}" is blocked in sandboxed handler code — handlers must use the injected \`ctx\` for all I/O`,
		);
		this.name = "SandboxLockdownError";
	}
}

/**
 * `defineSubgraph` (`define.ts`) is `<T>(def: T) => def` — a pure, zero-I/O
 * identity function that exists only for TS literal-type inference at
 * author-time. Every real handler file (`export default defineSubgraph({...})`)
 * imports it from `@secondlayer/subgraphs`, so blocking that one bare
 * specifier like every other would break every real subgraph. Rather than
 * carve out an allowlisted, still-node_modules-resolved escape hatch, stub
 * the whole package as an inline virtual module exporting the same identity
 * function — the handler's `defineSubgraph({...})` call evaluates to exactly
 * the same object either way, and the bundle never needs to resolve anything
 * outside itself at all (no allowlist to keep correct, nothing external
 * reachable from inside the worker).
 */
const SUBGRAPHS_PACKAGE_SPECIFIER = "@secondlayer/subgraphs";
const SUBGRAPHS_STUB_SOURCE =
	"export function defineSubgraph(def) { return def; }\n";

function resolverLockdownPlugin(): Plugin {
	return {
		name: "f071-sandbox-resolver-lockdown",
		setup(build) {
			build.onResolve({ filter: /^@secondlayer\/subgraphs$/ }, (args) => ({
				path: args.path,
				namespace: "f071-sandbox-subgraphs-stub",
			}));
			build.onLoad(
				{ filter: /.*/, namespace: "f071-sandbox-subgraphs-stub" },
				() => ({ contents: SUBGRAPHS_STUB_SOURCE, loader: "js" }),
			);

			// node:*, bun:* — hard-blocked, regardless of allowlist.
			build.onResolve({ filter: /^(node:|bun:)/ }, (args) => ({
				path: args.path,
				namespace: "f071-sandbox-blocked",
			}));
			// Any other bare (non-relative) specifier not on the allowlist and not
			// the subgraphs-package stub above — blocked. Handlers should never
			// need npm deps; this is what stops a handler from importing e.g.
			// `undici` and routing around the ctx membrane with its own network
			// calls.
			build.onResolve({ filter: /^[^./]/ }, (args) => {
				if (args.path === SUBGRAPHS_PACKAGE_SPECIFIER) return undefined;
				if (ALLOWED_BARE_SPECIFIERS.has(args.path)) return undefined;
				return { path: args.path, namespace: "f071-sandbox-blocked" };
			});
			build.onLoad(
				{ filter: /.*/, namespace: "f071-sandbox-blocked" },
				(args) => ({
					contents: `throw new Error(${JSON.stringify(
						`subgraph sandbox: import of "${args.path}" is blocked in sandboxed handler code — handlers must use the injected \`ctx\` for all I/O`,
					)});`,
					loader: "js",
				}),
			);
		},
	};
}

/**
 * Bundle a subgraph's `handler_code` (the full file — same content
 * `processor.ts` writes to disk and `import()`s today) into a single,
 * dependency-free ESM string ready to ship into a sandbox worker's `init`
 * message. Any `node:`, `bun:`, or bare-specifier import becomes a
 * throw-on-evaluation stub rather than resolving against the host.
 *
 * Bundles from a source STRING (not a file path) because `handler_code`
 * lives in the DB, not necessarily on disk in the sandbox path — `stdin`
 * lets esbuild treat the string as the entry point directly.
 */
export async function bundleHandlerCode(handlerCode: string): Promise<string> {
	const result = await esbuild.build({
		stdin: {
			contents: handlerCode,
			loader: "ts",
			resolveDir: process.cwd(),
		},
		bundle: true,
		platform: "neutral",
		format: "esm",
		write: false,
		// Named imports from a blocked module always resolve to `undefined` at
		// the type level (esbuild's `import-is-undefined` warning) — expected
		// and harmless here, since evaluating the stub throws before any such
		// binding is ever used. Silenced so a blocked import doesn't spam prod
		// logs on every deploy of a handler that (legitimately or not) imports
		// something outside its allowed graph.
		logLevel: "silent",
		plugins: [resolverLockdownPlugin()],
	});
	const out = result.outputFiles?.[0];
	if (!out)
		throw new Error("esbuild produced no output for handler_code bundle");
	return new TextDecoder().decode(out.contents);
}
