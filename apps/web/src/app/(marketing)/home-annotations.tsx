"use client";

export function HomeAnnotations() {
	return (
		<div className="prose">
			<p>Agent-native developer tools for Stacks.</p>
			<p>
				Subgraphs turn onchain events into queryable Postgres tables. Workflows
				run code when things happen — trigger on those events, a schedule, or on
				demand, then write steps that call AI, use MCP tools, query data, hit
				any API, deliver results.
			</p>
			<p>
				Use both through the CLI, SDK, or MCP server — same auth, same
				operations, same patterns whether you&apos;re scripting a deploy or an
				agent is calling a tool in a loop. Open source. Self-host or use hosted.
			</p>
			<p>
				<code>@secondlayer/stacks</code> is the viem-style Stacks SDK we build
				everything on top of — general-purpose, open source, available to anyone
				building on Stacks.
			</p>
		</div>
	);
}
