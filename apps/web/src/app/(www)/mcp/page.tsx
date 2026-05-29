import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "MCP server | secondlayer",
	description:
		"Model Context Protocol server so agents can list and query subgraphs, configure subscriptions, and invoke chain tools without wiring REST by hand.",
};

const toc: TocItem[] = [
	{ label: "Run it", href: "#run" },
	{ label: "Configure", href: "#configure" },
];

export default function McpPage() {
	return (
		<div className="article-layout">
			<Sidebar title="MCP server" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">MCP server</h1>
				</header>

				<div className="prose">
					<p>
						Model Context Protocol server so agents (Claude Code, Cursor, any
						MCP client) can list/query subgraphs, configure subscriptions, and
						invoke chain tools without you wiring REST calls by hand.
					</p>
				</div>

				<SectionHeading id="run">Run it</SectionHeading>

				<CodeBlock
					lang="bash"
					code={`bunx @secondlayer/mcp                     # stdio transport (default)
bunx @secondlayer/mcp --http              # HTTP transport on :3900`}
				/>

				<SectionHeading id="configure">Configure</SectionHeading>

				<CodeBlock
					lang="json"
					code={`// claude_desktop_config.json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["@secondlayer/mcp"],
      "env": { "SL_API_KEY": "sk-sl_..." }
    }
  }
}`}
				/>
			</main>
		</div>
	);
}
