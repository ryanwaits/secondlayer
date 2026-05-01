"use client";

export function HomeAnnotations() {
	return (
		<div className="prose">
			<p>Agent-native infrastructure for Stacks monitoring and response.</p>
			<p>
				Define subgraphs that turn contract calls, events, and transfers into
				structured API tables. Subscribe to the rows that matter with signed
				webhooks, then route them into workflows that alert, triage, and
				respond.
			</p>
			<p>
				Use the same primitives from the CLI, SDK, or MCP server: deploy
				monitors, query evidence, create subscriptions, and let agents operate
				safely against your Stacks data. Open source. Self-host or use hosted.
			</p>
			<p>
				<code>@secondlayer/stacks</code> is the viem-style Stacks SDK we build
				everything on top of — general-purpose, open source, available to anyone
				building on Stacks.
			</p>
		</div>
	);
}
