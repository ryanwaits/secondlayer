import { CodeBlock } from "@/components/code-block";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Subgraphs", href: "#subgraphs" },
	{ label: "Typed subgraphs", href: "#typed-subgraphs" },
	{ label: "Workflows", href: "#workflows" },
	{ label: "Error handling", href: "#error-handling" },
];

export default function SdkPage() {
	return (
		<div className="article-layout">
			<Sidebar title="SDK" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">SDK</h1>
				</header>

				<div className="prose">
					<p>
						Both primitives as a TypeScript client. Deploy subgraphs, query
						tables, trigger workflows — same auth, same operations as the CLI
						and MCP server.
					</p>
					<p>
						Install with <code>bun add @secondlayer/sdk</code>.
					</p>
				</div>

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer } from "@secondlayer/sdk"

const client = new SecondLayer({ apiKey: "sk-sl_..." })

client.subgraphs    // deploy, query, reindex
client.workflows    // deploy, trigger, manage`}
				/>

				<SectionHeading id="subgraphs">Subgraphs</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`// Query a table
const { data, meta } = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  {
    sort: "_block_height",
    order: "desc",
    limit: 50,
    filters: { sender: "SP1234...", "amount.gte": "1000000" },
  }
)

// Count rows
const { count } = await client.subgraphs.queryTableCount(
  "token-transfers",
  "transfers",
  { filters: { sender: "SP1234..." } }
)`}
				/>

				<SectionHeading id="typed-subgraphs">Typed subgraphs</SectionHeading>

				<div className="prose">
					<p>
						Import your subgraph definition to get a fully typed query client —
						table names, column names, and filter operators all inferred from
						your schema.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { getSubgraph } from "@secondlayer/sdk"
import mySubgraph from "./subgraphs/token-transfers"

const typed = getSubgraph(mySubgraph, { apiKey: "sk-sl_..." })

const rows = await typed.transfers.findMany({
  where: { sender: { eq: "SP1234..." }, amount: { gte: 1000000n } },
  orderBy: { _blockHeight: "desc" },
  limit: 25,
})

const total = await typed.transfers.count({ sender: { eq: "SP1234..." } })`}
				/>

				<SectionHeading id="workflows">Workflows</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`import { SecondLayer, VersionConflictError } from "@secondlayer/sdk"

// Deploy
try {
  const result = await client.workflows.deploy({
    name: "whale-alerts",
    trigger: { type: "event", filter: { type: "stx_transfer" } },
    handlerCode: bundledCode,
    sourceCode: tsSource,
    expectedVersion: "1.0.3",  // 409 if stale
  })
  console.log(result.version)  // "1.0.4"
} catch (err) {
  if (err instanceof VersionConflictError) {
    console.log("current is", err.currentVersion)
  }
}

// Trigger a manual run
const { runId } = await client.workflows.trigger("whale-alerts", {
  contractId: "SP1234...",
})`}
				/>

				<SectionHeading id="error-handling">Error handling</SectionHeading>

				<CodeBlock
					lang="typescript"
					code={`import { ApiError, VersionConflictError } from "@secondlayer/sdk"

try {
  await client.subgraphs.get("nonexistent")
} catch (err) {
  if (err instanceof ApiError) {
    err.status   // 404
    err.message  // "Subgraph not found"
  }
}

// 401 invalid key  |  404 not found  |  409 version conflict
// 413 bundle too large  |  429 rate limited  |  5xx server error`}
				/>
			</main>
		</div>
	);
}
