import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Install", href: "#install" },
	{ label: "Tools", href: "#tools" },
];

export default function McpPage() {
	return (
		<div className="article-layout">
			<Sidebar title="MCP" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">MCP</h1>
				</header>

				<div className="prose">
					<p>
						The same operations as the CLI and SDK, exposed as MCP tools — so
						any agent that speaks MCP can deploy subgraphs, manage
						subscriptions, query data, and scaffold from contracts without
						leaving its loop.
					</p>
					<p>
						Install with <code>bun add @secondlayer/mcp</code>.
					</p>
				</div>

				<SectionHeading id="install">Install</SectionHeading>

				<div className="prose">
					<p>
						Add to your Claude Desktop, Cursor, or any MCP-compatible client
						config:
					</p>
				</div>

				<CodeBlock
					lang="json"
					code={`{
  "mcpServers": {
    "secondlayer": {
      "command": "npx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SL_SERVICE_KEY": "sk-sl_..."
      }
    }
  }
}`}
				/>

				<div className="prose">
					<p>Or run as an HTTP server for remote agents:</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`SL_SERVICE_KEY=sk-sl_... npx @secondlayer/mcp-http
# Listening on port 3100`}
				/>

				<SectionHeading id="tools">Tools</SectionHeading>

				<div
					className="props-section"
					style={{ marginTop: "var(--spacing-xs)" }}
				>
					<div className="props-group-title">Subgraphs</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_list</span>
						<span className="prop-type">List deployed subgraphs</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_get</span>
						<span className="prop-type">Get subgraph details and health</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_query</span>
						<span className="prop-type">
							Query a table — filters, sort, limit, count
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_deploy</span>
						<span className="prop-type">Deploy a subgraph definition</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_reindex</span>
						<span className="prop-type">
							Reindex from scratch or a block range
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_delete</span>
						<span className="prop-type">Delete subgraph and all data</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subgraphs_read_source</span>
						<span className="prop-type">
							Fetch the deployed TypeScript source of a subgraph
						</span>
					</div>

					<div className="props-group-title">Subscriptions</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_list</span>
						<span className="prop-type">List subscriptions for the account</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_get</span>
						<span className="prop-type">Get subscription details</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_create</span>
						<span className="prop-type">
							Create a webhook subscription with filter + wire format
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_update</span>
						<span className="prop-type">Edit url, filter, or format</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_delete</span>
						<span className="prop-type">Delete a subscription</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_replay</span>
						<span className="prop-type">
							Re-enqueue a block range for this subscription
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">subscriptions_recent_deliveries</span>
						<span className="prop-type">
							Last 100 attempts with status codes + duration
						</span>
					</div>

					<div className="props-group-title">Scaffold</div>
					<div className="prop-row">
						<span className="prop-name">scaffold_from_contract</span>
						<span className="prop-type">
							Generate a subgraph from a deployed contract address
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">scaffold_from_abi</span>
						<span className="prop-type">
							Generate a subgraph from a raw ABI
						</span>
					</div>

					<div className="props-group-title">Account</div>
					<div className="prop-row">
						<span className="prop-name">account_whoami</span>
						<span className="prop-type">
							Show the authenticated account's email and plan
						</span>
					</div>
				</div>
			</main>
		</div>
	);
}
