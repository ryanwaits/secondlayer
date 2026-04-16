"use client";

export function HomeAnnotations() {
	return (
		<div className="prose">
			<p>Developer tools for Stacks.</p>
			<p>
				Two primitives that compose. Subgraphs turn onchain events into
				queryable tables. Workflows run on top — trigger on those events, query
				those tables, decide, act. Same CLI, same SDK, same auth.
			</p>
			<p>
				Atomic pieces that work the same way everywhere — as a CLI command, an
				API call, or a tool an agent picks up in a loop. Open source. Self-host
				or use hosted. Built on <code>@secondlayer/stacks</code>, a viem-style
				SDK we dogfood across everything we ship.
			</p>
		</div>
	);
}
