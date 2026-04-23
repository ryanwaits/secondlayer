import { BoxBadge } from "@/components/box-badge";
import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { MARKETING_SUBGRAPHS_PROMPT } from "@/lib/agent-prompts";

const toc: TocItem[] = [
	{ label: "Getting started", href: "#getting-started" },
	{ label: "Schema", href: "#schema" },
	{ label: "Handlers", href: "#handlers" },
	{ label: "Deploy", href: "#deploy" },
	{ label: "Querying", href: "#querying" },
];

export default function SubgraphsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Subgraphs" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Subgraphs <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Subgraphs turn onchain events into custom views of the chain — pick
						the events your app needs and shape them into a queryable API.
					</p>
					<p>
						Install with <code>bun add @secondlayer/subgraphs</code>.
					</p>
				</div>

				<AgentPromptBlock
					title="Set up subgraphs with your agent."
					code={MARKETING_SUBGRAPHS_PROMPT}
					collapsible
				/>

				<SectionHeading id="getting-started">Getting started</SectionHeading>

				<div className="prose">
					<p>
						A subgraph has three parts: sources (what events to listen for), a
						schema (what tables to create), and handlers (how to process each
						event into rows).
					</p>
				</div>

				<CodeBlock
					code={`import { defineSubgraph } from "@secondlayer/subgraphs"

export default defineSubgraph({
  name: "stx-transfers",
  sources: {
    transfer: { type: "stx_transfer" },
  },
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
        memo: { type: "text", nullable: true },
      },
    },
  },
  handlers: {
    transfer: (event, ctx) => {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
        memo: event.memo,
      })
    },
  },
})`}
				/>

				<SectionHeading id="schema">Schema</SectionHeading>

				<div className="prose">
					<p>
						Each subgraph gets its own PostgreSQL schema (
						<code>subgraph_&lt;name&gt;</code>). Tables are defined
						declaratively with typed columns. System columns are added
						automatically: <code>_id</code>, <code>_block_height</code>,{" "}
						<code>_tx_id</code>, <code>_created_at</code>. Enable full-text
						search on any text column with <code>search: true</code>.
					</p>
				</div>

				<CodeBlock
					code={`schema: {
  balances: {
    columns: {
      address: { type: "principal", indexed: true },
      token: { type: "text", indexed: true, search: true },
      amount: { type: "uint" },
    },
    uniqueKeys: [["address", "token"]], // enables upsert
  },
}

// Column types: text, uint, int, principal, boolean, timestamp, jsonb`}
				/>

				<SectionHeading id="handlers">Handlers</SectionHeading>

				<div className="prose">
					<p>
						Handlers process events into table rows. The context object provides
						write, read, and aggregate operations — all batched and flushed
						atomically per block.
					</p>
				</div>

				<CodeBlock
					code={`handlers: {
  transfer: async (event, ctx) => {
    // Write
    ctx.insert("transfers", { sender: event.sender, amount: event.amount })
    ctx.upsert("balances", { address: event.sender }, { amount: event.amount }) // key, values — requires uniqueKeys
    ctx.update("balances", { address: "SP..." }, { amount: 0n })
    ctx.delete("balances", { address: "SP..." })

    // Read
    const row = await ctx.findOne("balances", { address: event.sender })
    const rows = await ctx.findMany("balances", { token: "usda" })

    // Block / tx metadata
    ctx.block.height     // current block height
    ctx.tx.txId          // transaction id
    ctx.tx.sender        // transaction sender
  },
}`}
				/>

				<SectionHeading id="deploy">Deploy</SectionHeading>

				<CodeBlock
					lang="bash"
					code={`# Deploy to Second Layer
sl subgraphs deploy subgraphs/token-transfers.ts

# Dev mode — watches for changes, auto-redeploys
sl subgraphs dev subgraphs/token-transfers.ts

# Scaffold from a deployed contract's ABI
sl subgraphs scaffold SP1234ABCD.my-contract --output subgraphs/my-contract.ts

# Force reindex
sl subgraphs reindex token-transfers`}
				/>

				<SectionHeading id="querying">Querying</SectionHeading>

				<div className="prose">
					<p>
						Query via the SDK, CLI, or HTTP API. Supports filtering, comparison
						operators, ordering, and pagination. For typed queries with
						autocompletion, see{" "}
						<a href="/sdk#typed-subgraphs">typed subgraphs</a> in the SDK docs.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`const rows = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  {
    sort: "_block_height",
    order: "desc",
    limit: 25,
    filters: { sender: "SP1234...", "amount.gte": "1000000" },
  }
)

// CLI
sl subgraphs query token-transfers transfers --sort _block_height --order desc
sl subgraphs query token-transfers transfers --filter sender=SP1234... --count

// HTTP API
curl -H "Authorization: Bearer $SL_SERVICE_KEY" \\
  "https://<your-slug>.secondlayer.tools/api/subgraphs/token-transfers/transfers?_sort=_block_height&_order=desc&_limit=25&sender=SP1234...&amount.gte=1000000"`}
				/>
			</main>
		</div>
	);
}
