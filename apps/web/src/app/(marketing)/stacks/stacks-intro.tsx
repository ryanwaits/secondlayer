"use client";

export function StacksIntro() {
	return (
		<div className="prose">
			<p>
				A viem-style SDK for Stacks — the foundation everything else is built
				on. One package, zero polyfills, full tree-shaking. Built on
				audited <code>@noble/*</code> + <code>@scure/*</code> crypto
				primitives, not a browser-polyfill tarball. We dogfood it across
				the CLI, the indexer, and the subscription emitter.
			</p>
			<p>
				Install with <code>bun add @secondlayer/stacks</code>.
			</p>
		</div>
	);
}
