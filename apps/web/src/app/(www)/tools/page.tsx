import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Tools | secondlayer",
	description:
		"SDK, CLI, MCP server, and the agent-native @secondlayer/stacks chain SDK.",
};

const toc: TocItem[] = [
	{ label: "SDK", href: "#sdk" },
	{ label: "CLI", href: "#cli" },
	{ label: "MCP server", href: "#mcp" },
	{ label: "@secondlayer/stacks", href: "#stacks" },
];

export default function ToolsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Tools" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">Tools</h1>
				</header>

				<div className="prose">
					<p>
						The four developer surfaces around the platform. Same auth across
						all of them — sign in once with the CLI, every tool inherits the
						session.
					</p>
				</div>

				<SectionHeading id="sdk">SDK</SectionHeading>

				<div className="prose">
					<p>
						TypeScript client for Streams, Subgraphs, and Subscriptions. Deploy
						subgraphs, query tables, manage row-change webhooks — programmatic
						parity with the CLI.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={"bun add @secondlayer/sdk @secondlayer/stacks"}
				/>

				<CodeBlock
					lang="typescript"
					code={`import { createClient, createStreamsClient } from "@secondlayer/sdk";

const client = createClient({ apiKey: process.env.SL_SERVICE_KEY! });
await client.subgraphs.queryTable("my-watcher", "transfers", { _limit: 10 });
await client.subscriptions.create({ ... });

const streams = createStreamsClient({ apiKey: process.env.SL_STREAMS_API_KEY! });
await streams.events.consume({ types: ["print"], onBatch: async (events) => { ... } });`}
				/>

				<SectionHeading id="cli">CLI</SectionHeading>

				<div className="prose">
					<p>
						One binary for everything you'd otherwise click through dashboards
						for. Login, deploy, query, manage subscriptions, tail Streams,
						provision dedicated instances.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`bun add -g @secondlayer/cli

sl login                                  # magic-link email
sl subgraphs new my-watcher --template sip-010-balances
sl subgraphs deploy my-watcher.ts         # prompts login if no session
sl subgraphs query my-watcher transfers --filter recipient=SP1...
sl streams events --types print --contract-id SP2...BNS-V2
sl create subscription my-watcher --runtime node`}
				/>

				<SectionHeading id="mcp">MCP server</SectionHeading>

				<div className="prose">
					<p>
						Model Context Protocol server so agents (Claude Code, Cursor, any
						MCP client) can list/query subgraphs, configure subscriptions, and
						invoke chain tools without you wiring REST calls by hand.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`bunx @secondlayer/mcp                     # stdio transport (default)
bunx @secondlayer/mcp --http              # HTTP transport on :3900`}
				/>

				<CodeBlock
					lang="json"
					code={`// claude_desktop_config.json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["@secondlayer/mcp"],
      "env": { "SL_SERVICE_KEY": "sk-sl_..." }
    }
  }
}`}
				/>

				<SectionHeading id="stacks">@secondlayer/stacks</SectionHeading>

				<div className="prose">
					<p>
						The agent-native Stacks chain SDK. Typed contract reads + writes, AI
						SDK <code>tool({"{...}"})</code> values, and the <code>on.*</code>{" "}
						filter factories that produce typed{" "}
						<Link href="/subscriptions">Subscription</Link> specs.
					</p>
				</div>

				<CodeBlock lang="bash" code={"bun add @secondlayer/stacks"} />

				<CodeBlock
					lang="typescript"
					code={`import { on } from "@secondlayer/stacks";

// Typed subscription filter — bind to a subgraph table you own.
const spec = on.transferTo(
  { subgraph: "my-watcher", table: "transfers" },
  "SP1ABC...",
  { asset: "SP1...usdc::usdc-token" },
);

// Available: on.transferTo, on.sip010Transfer, on.sip009Transfer,
//            on.bnsName, on.poxStack, on.sbtcDeposit, on.sbtcWithdrawal`}
				/>
			</main>
		</div>
	);
}
