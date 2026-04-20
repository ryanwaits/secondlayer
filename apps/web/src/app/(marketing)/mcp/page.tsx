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
						any agent that speaks MCP can deploy subgraphs, trigger workflows,
						query data, and scaffold from contracts without leaving its loop.
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

					<div className="props-group-title">Workflows</div>
					<div className="prop-row">
						<span className="prop-name">workflows_list</span>
						<span className="prop-type">List deployed workflows</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">workflows_get</span>
						<span className="prop-type">Get workflow details</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">workflows_trigger</span>
						<span className="prop-type">Trigger a run with optional input</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">workflows_runs</span>
						<span className="prop-type">List run history</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">workflows_pause</span>
						<span className="prop-type">Pause a workflow</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">workflows_resume</span>
						<span className="prop-type">Resume a workflow</span>
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
				</div>
			</main>
		</div>
	);
}
