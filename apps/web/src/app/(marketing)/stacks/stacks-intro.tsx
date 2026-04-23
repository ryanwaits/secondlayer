"use client";

export function StacksIntro() {
	return (
		<div className="prose">
			<p>
				A viem-style SDK for Stacks — the foundation everything else is built
				on. One package, zero polyfills, full tree-shaking. 23.8 KB gzipped with
				6 runtime dependencies — 11.6x smaller than stacks.js. We dogfood it
				across the CLI, the indexer, and the subscription emitter.
			</p>
			<p>
				Install with <code>bun add @secondlayer/stacks</code>.
			</p>
		</div>
	);
}
