// f060 SPIKE — host-side (trusted) bundling with a locked-down module
// resolver, mirroring the "locked-down module resolver" half of the D3
// target design (worker gets no node:* builtins, no bare npm specifiers).
//
// This runs on the HOST, before the artifact ever reaches the worker — same
// shape as the existing production stub-plugin
// (packages/bundler/src/stub-plugin.ts) that f049's spike already documented,
// just with a deny-list instead of a rewrite. `platform: "neutral"` (not
// "node") means esbuild does NOT auto-resolve node builtins against the host;
// every non-relative specifier must be explicitly handled by a plugin or the
// bundle fails to resolve, which is itself a second layer of defense (an
// unrecognized import fails CLOSED, not open).
import esbuild, { type Plugin } from "esbuild";

/** Bare specifiers a sandboxed handler is allowed to reference. Empty on
 *  purpose — handlers get everything they need through the injected `ctx`
 *  global; no import should ever be necessary. */
const ALLOWED_BARE_SPECIFIERS = new Set<string>();

function resolverLockdownPlugin(): Plugin {
	return {
		name: "f060-resolver-lockdown",
		setup(build) {
			// node:*, bun:*, and node built-ins referenced without the protocol
			// (fs, child_process, ...) — hard-blocked.
			build.onResolve({ filter: /^(node:|bun:)/ }, (args) => ({
				path: args.path,
				namespace: "f060-blocked",
			}));
			// Any other bare (non-relative, non-blocked-protocol) specifier not on
			// the allowlist — also blocked. Handlers should never need npm deps;
			// this is what stops a handler from importing e.g. `undici` and
			// making its own network calls to route around the ctx membrane.
			build.onResolve({ filter: /^[^./]/ }, (args) => {
				if (ALLOWED_BARE_SPECIFIERS.has(args.path)) return undefined;
				return { path: args.path, namespace: "f060-blocked" };
			});
			build.onLoad({ filter: /.*/, namespace: "f060-blocked" }, (args) => ({
				contents: `throw new Error(${JSON.stringify(
					`f060 resolver lockdown: import of "${args.path}" is blocked in sandboxed handler code`,
				)});`,
				loader: "js",
			}));
		},
	};
}

/**
 * Bundle a handler source file into a single, dependency-free ESM string
 * ready to ship into the worker. Any node:, bun:, or bare-specifier import
 * becomes a throw-on-evaluation stub rather than resolving against the host.
 */
export async function bundleHandlerSource(sourcePath: string): Promise<string> {
	const result = await esbuild.build({
		entryPoints: [sourcePath],
		bundle: true,
		platform: "neutral",
		format: "esm",
		write: false,
		plugins: [resolverLockdownPlugin()],
	});
	const out = result.outputFiles?.[0];
	if (!out) throw new Error(`esbuild produced no output for ${sourcePath}`);
	return new TextDecoder().decode(out.contents);
}
