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
	{ label: "Querying", href: "#querying" },
	{ label: "Typed client", href: "#typed-client" },
	{ label: "Search", href: "#search" },
	{ label: "Deploy", href: "#deploy" },
	{ label: "Chat authoring", href: "#chat-authoring" },
	{ label: "Props", href: "#props" },
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
						Subgraphs let you build custom views of Stacks onchain data. Define
						the events you care about, write TypeScript handlers that transform
						them into SQL rows, and secondlayer indexes everything into
						queryable Postgres tables — your own slice of the chain, shaped
						exactly how your app needs it.
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
						A subgraph definition has three parts: sources (what events to
						listen for), a schema (what tables to create), and handlers (how to
						process each event into rows).
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
						automatically: <code>_id</code>, <code>_blockHeight</code>,{" "}
						<code>_txId</code>, <code>_createdAt</code>.
					</p>
				</div>

				<CodeBlock
					code={`schema: {
  balances: {
    columns: {
      address: { type: "principal", indexed: true },
      token: { type: "text", indexed: true },
      amount: { type: "uint" },
    },
    uniqueKeys: [["address", "token"]], // enables upsert
    indexes: [["token", "amount"]],     // composite index
  },
}`}
				/>

				<div
					className="props-section"
					style={{ marginTop: "var(--spacing-xs)" }}
				>
					<div className="props-group-title">Column types</div>

					<div className="prop-row">
						<span className="prop-name">text</span>
						<span className="prop-type">PostgreSQL TEXT</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">uint</span>
						<span className="prop-type">NUMERIC(78,0)</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">int</span>
						<span className="prop-type">BIGINT</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">principal</span>
						<span className="prop-type">TEXT (Stacks address)</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">boolean</span>
						<span className="prop-type">BOOLEAN</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">timestamp</span>
						<span className="prop-type">TIMESTAMPTZ</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">jsonb</span>
						<span className="prop-type">JSONB</span>
					</div>
				</div>

				<SectionHeading id="handlers">Handlers</SectionHeading>

				<div className="prose">
					<p>
						Handlers process events into table rows. Each handler key must match
						a source name. The handler receives a typed event and a context
						object with write, read, and aggregate operations.
					</p>
				</div>

				<CodeBlock
					code={`handlers: {
  transfer: async (event, ctx) => {
    // Write operations (batched, flushed atomically):
    ctx.insert("transfers", { ... })
    ctx.upsert("balances", { ... })     // requires uniqueKeys
    ctx.update("balances", { address: "SP..." }, { amount: 0 })
    ctx.delete("balances", { address: "SP..." })
    ctx.patch("balances", { address: "SP..." }, { amount: 0 }) // partial update

    // Find-then-merge-or-insert (async — values can be functions):
    await ctx.patchOrInsert("holders", { address: event.sender }, {
      address: event.sender,
      balance: (existing) => (existing?.balance ?? 0n) + event.amount,
      tx_count: (existing) => (existing?.tx_count ?? 0n) + 1n,
    })

    // Read operations (immediate):
    const row = await ctx.findOne("balances", { address: "SP..." })
    const rows = await ctx.findMany("balances", { token: "usda" })

    // Aggregates:
    const total = await ctx.count("transfers")
    const sum = await ctx.sum("transfers", "amount")

    // Formatting:
    ctx.formatUnits(1000000n, 6)  // "1.000000"

    // Block/tx metadata:
    ctx.block.height         // current block height
    ctx.block.timestamp      // block timestamp
    ctx.tx.txId              // current transaction id
    ctx.tx.sender            // tx sender
    ctx.tx.contractId        // called contract (if contract_call)
    ctx.tx.functionName      // called function (if contract_call)
  },
}`}
				/>

				<SectionHeading id="querying">Querying</SectionHeading>

				<div className="prose">
					<p>
						Once deployed, query subgraphs through the SDK or CLI. The query API
						supports filtering, comparison operators, ordering, pagination, and
						field selection.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`// Via SDK
const { data, meta } = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  {
    sort: "_block_height",
    order: "desc",
    limit: 25,
    offset: 0,
    filters: { sender: "SP1234..." },
  }
)

// Comparison operators via dot notation
const { data } = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  { filters: { "amount.gte": "1000000" } }
)

// Get row count
const { count } = await client.subgraphs.queryTableCount(
  "token-transfers",
  "transfers",
  { filters: { sender: "SP1234..." } }
)

// Via CLI
sl subgraphs query token-transfers transfers --sort _block_height --order desc --limit 25
sl subgraphs query token-transfers transfers --filter sender=SP1234... --count`}
				/>

				<SectionHeading id="typed-client">Typed client</SectionHeading>

				<div className="prose">
					<p>
						The SDK can infer TypeScript types from your subgraph definition,
						giving you typed queries with autocompletion for table names, column
						names, and filter operators.
					</p>
				</div>

				<CodeBlock
					lang="typescript"
					code={`import { getSubgraph } from "@secondlayer/sdk"
import mySubgraph from "./subgraphs/token-transfers"

const client = getSubgraph(mySubgraph, { apiKey: "sk-sl_..." })

// Fully typed — table names, column names, where operators
const rows = await client.transfers.findMany({
  where: { sender: { eq: "SP1234..." } },
  orderBy: { _blockHeight: "desc" },
  limit: 25,
})

const total = await client.transfers.count({
  sender: { eq: "SP1234..." },
})

// Or via the SecondLayer instance
const client = new SecondLayer({ apiKey: "sk-sl_..." })
const typed = client.subgraphs.typed(mySubgraph)
const rows = await typed.transfers.findMany({ ... })`}
				/>

				<SectionHeading id="search">Search</SectionHeading>

				<div className="prose">
					<p>
						Enable full-text search on any text column with the{" "}
						<code>search: true</code> flag. This creates a PostgreSQL trigram
						index (pg_trgm) for fast fuzzy matching.
					</p>
				</div>

				<CodeBlock
					code={`schema: {
  contracts: {
    columns: {
      name: { type: "text", search: true },
      deployer: { type: "principal", indexed: true },
    },
  },
}

// Query with search via REST API
const { data } = await client.subgraphs.queryTable("contracts", "contracts", {
  search: "token",
})`}
				/>

				<SectionHeading id="deploy">Deploy</SectionHeading>

				<div className="prose">
					<p>
						Deploy subgraphs via the CLI. The CLI bundles your handler code with
						esbuild and posts it to the API. Schema changes are diffed
						automatically — additive changes are applied in place, breaking
						changes require a reindex.
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`# Deploy to Second Layer
sl subgraphs deploy subgraphs/token-transfers.ts

# Dev mode — watches for changes, auto-redeploys
sl subgraphs dev subgraphs/token-transfers.ts

# Force reindex (drops and recreates schema)
sl subgraphs reindex token-transfers

# Reindex from a specific block range
sl subgraphs reindex token-transfers --from 150000 --to 160000

# Scaffold a subgraph from a deployed contract's ABI
sl subgraphs scaffold SP1234...::my-contract --output subgraphs/my-contract.ts`}
				/>

				<SectionHeading id="chat-authoring">Chat authoring</SectionHeading>

				<div className="prose">
					<p>
						The full scaffold → deploy → read → edit → tail loop runs in chat,
						without leaving the browser. A user describes a contract they want
						to index; the agent calls <code>scaffold_subgraph</code> with the{" "}
						<code>contractId</code>, fetches the ABI, emits a{" "}
						<code>defineSubgraph()</code> skeleton, and pauses for confirmation.
						On deploy, the server bundles the TypeScript with esbuild (via{" "}
						<code>POST /api/subgraphs/bundle</code>), validates the definition,
						and persists both the bundled handler and the original source so the
						agent can read and edit it later.
					</p>
					<p>
						Editing works the same way as workflows: the agent calls{" "}
						<code>read_subgraph</code> to fetch the deployed TypeScript from{" "}
						<code>GET /api/subgraphs/:name/source</code>, proposes a diff via{" "}
						<code>edit_subgraph</code>, and the client renders a unified diff
						card backed by the shared <code>buildUnifiedDiff</code> helper.
						Confirming re-bundles and redeploys through the same chat origin.
						Subgraphs deployed before source capture land in the DB with{" "}
						<code>source_code = NULL</code> and come back as{" "}
						<code>{"{ readOnly: true }"}</code> — those need a CLI redeploy once
						before they're chat-editable.
					</p>
					<p>
						<strong>Reindex semantics.</strong> When an edit touches schema
						columns or sources, the server's schema diff detects a breaking
						change and kicks off an automatic reindex from the subgraph's{" "}
						<code>startBlock</code>. The chat instructions make the agent warn
						the user before confirming any edit that will drop and repopulate
						rows.
					</p>
					<p>
						After deploy, <code>tail_subgraph_sync</code> polls{" "}
						<code>GET /api/subgraphs/:name</code> every two seconds and shows a
						live progress bar against the chain tip, stopping when the subgraph
						catches up. The platform dashboard also has an{" "}
						<strong>Open in chat</strong> button on every subgraph detail page —
						it seeds a new session with a <code>read_subgraph</code> prompt so
						you can jump from the UI straight into the authoring loop.
					</p>
					<p>
						Chat session tools: <code>scaffold_subgraph</code>,{" "}
						<code>deploy_subgraph</code>, <code>read_subgraph</code>,{" "}
						<code>edit_subgraph</code>, <code>tail_subgraph_sync</code>,{" "}
						<code>check_subgraphs</code>, <code>query_subgraph</code>,{" "}
						<code>manage_subgraphs</code>. MCP equivalents for external agents
						(Claude Desktop, Inspector): <code>subgraphs_deploy</code>,{" "}
						<code>subgraphs_read_source</code>, <code>subgraphs_list</code>,{" "}
						<code>subgraphs_get</code>, <code>subgraphs_query</code>,{" "}
						<code>subgraphs_reindex</code>, <code>subgraphs_delete</code>.
					</p>
				</div>

				<SectionHeading id="props">Props</SectionHeading>

				<div className="props-section">
					<div className="props-group-title">defineSubgraph</div>

					<div className="prop-row">
						<span className="prop-name">name</span>
						<span className="prop-type">string</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">version</span>
						<span className="prop-type">string</span>
						<span className="prop-default">&quot;1.0.0&quot;</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">description</span>
						<span className="prop-type">string</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">startBlock</span>
						<span className="prop-type">number</span>
						<span className="prop-default">1</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">sources</span>
						<span className="prop-type">
							Record&lt;string, SubgraphFilter&gt;
						</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">schema</span>
						<span className="prop-type">
							Record&lt;string, SubgraphTable&gt;
						</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">handlers</span>
						<span className="prop-type">
							Record&lt;string, SubgraphHandler&gt;
						</span>
						<span className="prop-required">required</span>
					</div>

					<div className="props-group-title">Column options</div>

					<div className="prop-row">
						<span className="prop-name">type</span>
						<span className="prop-type">ColumnType</span>
						<span className="prop-required">required</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">indexed</span>
						<span className="prop-type">boolean</span>
						<span className="prop-default">false</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">search</span>
						<span className="prop-type">boolean</span>
						<span className="prop-default">false</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">nullable</span>
						<span className="prop-type">boolean</span>
						<span className="prop-default">false</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">default</span>
						<span className="prop-type">string | number | boolean</span>
					</div>

					<div className="props-group-title">SubgraphFilter types</div>

					<div className="prop-row">
						<span className="prop-name">stx_transfer</span>
						<span className="prop-type">
							sender?, recipient?, minAmount?, maxAmount?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">ft_transfer</span>
						<span className="prop-type">
							assetIdentifier?, sender?, recipient?, minAmount?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">ft_mint / ft_burn</span>
						<span className="prop-type">
							assetIdentifier?, sender/recipient?, minAmount?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">nft_transfer</span>
						<span className="prop-type">
							assetIdentifier?, sender?, recipient?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">nft_mint / nft_burn</span>
						<span className="prop-type">
							assetIdentifier?, sender/recipient?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">contract_call</span>
						<span className="prop-type">
							contractId?, functionName?, caller?, abi?
						</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">contract_deploy</span>
						<span className="prop-type">deployer?, contractName?</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">print_event</span>
						<span className="prop-type">contractId?, topic?</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">stx_mint / stx_burn / stx_lock</span>
						<span className="prop-type">address filters, minAmount?</span>
					</div>

					<div className="props-group-title">Query operators</div>

					<div className="prop-row">
						<span className="prop-name">eq / neq</span>
						<span className="prop-type">Exact match / not equal</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">gt / gte</span>
						<span className="prop-type">Greater than / greater or equal</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">lt / lte</span>
						<span className="prop-type">Less than / less or equal</span>
					</div>
					<div className="prop-row">
						<span className="prop-name">like</span>
						<span className="prop-type">Pattern matching</span>
					</div>
				</div>
			</main>
		</div>
	);
}
