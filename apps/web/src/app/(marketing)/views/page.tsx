import { Sidebar } from "@/components/sidebar";
import { SectionHeading } from "@/components/section-heading";
import { CodeBlock } from "@/components/code-block";
import { BoxBadge } from "@/components/box-badge";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { MARKETING_VIEWS_PROMPT } from "@/lib/agent-prompts";
import type { TocItem } from "@/components/sidebar";

const toc: TocItem[] = [
  { label: "Getting started", href: "#getting-started" },
  { label: "Schema", href: "#schema" },
  { label: "Handlers", href: "#handlers" },
  { label: "Querying", href: "#querying" },
  { label: "Typed client", href: "#typed-client" },
  { label: "Search", href: "#search" },
  { label: "Deploy", href: "#deploy" },
  { label: "Props", href: "#props" },
];

export default function ViewsPage() {
  return (
    <div className="article-layout">
      <Sidebar title="Views" toc={toc} />

      <main className="content-area">
        <header className="page-header">
          <h1 className="page-title">Views <BoxBadge>Beta</BoxBadge></h1>
        </header>

        <div className="prose">
          <p>
            Views are declarative SQL tables that auto-index blockchain data.
            Define a schema, write event handlers, deploy, and query — like a
            materialized view over the chain.
          </p>
          <p>
            Install with <code>bun add @secondlayer/views</code>.
          </p>
        </div>

        <AgentPromptBlock

          title="Set up views with your agent."
          code={MARKETING_VIEWS_PROMPT}
          collapsible
        />

        <SectionHeading id="getting-started">Getting started</SectionHeading>

        <div className="prose">
          <p>
            A view definition has three parts: sources (what events to listen
            for), a schema (what tables to create), and handlers (how to process
            each event into rows).
          </p>
        </div>

        <CodeBlock code={`import { defineView } from "@secondlayer/views"

export default defineView({
  name: "token-transfers",
  version: 1,
  sources: [
    { type: "stx-transfer" },
  ],
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
    "*": async (event, ctx) => {
      await ctx.insert("transfers", {
        sender: event.tx.sender,
        recipient: event.data.recipient,
        amount: event.data.amount,
        memo: event.data.memo,
      })
    },
  },
})`} />

        <SectionHeading id="schema">Schema</SectionHeading>

        <div className="prose">
          <p>
            Each view gets its own PostgreSQL schema (<code>view_&lt;name&gt;</code>).
            Tables are defined declaratively with typed columns. System columns
            are added automatically: <code>_id</code>, <code>_blockHeight</code>,{" "}
            <code>_txId</code>, <code>_createdAt</code>.
          </p>
        </div>

        <CodeBlock code={`schema: {
  balances: {
    columns: {
      address: { type: "principal", indexed: true },
      token: { type: "text", indexed: true },
      amount: { type: "uint" },
    },
    uniqueKeys: [["address", "token"]], // enables upsert
    indexes: [["token", "amount"]],     // composite index
  },
}`} />

        <div className="props-section" style={{ marginTop: "var(--spacing-xs)" }}>
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
            Handlers process events into table rows. Each handler receives the
            event and a context object with write and read operations. Use{" "}
            <code>&quot;*&quot;</code> as a catch-all or match specific source keys.
          </p>
        </div>

        <CodeBlock code={`handlers: {
  "*": async (event, ctx) => {
    // Write operations (batched, flushed atomically):
    await ctx.insert("transfers", { ... })
    await ctx.upsert("balances", { ... }) // requires uniqueKeys
    await ctx.update("balances", { amount: 0 }, { address: "SP..." })
    await ctx.delete("balances", { address: "SP..." })

    // Read operations (immediate):
    const row = await ctx.findOne("balances", { address: "SP..." })
    const rows = await ctx.findMany("balances", { token: "usda" })

    // Block/tx metadata:
    ctx.blockHeight   // current block
    ctx.txId          // current transaction
    ctx.timestamp     // block timestamp
    ctx.sender        // tx sender
  },
}`} />

        <SectionHeading id="querying">Querying</SectionHeading>

        <div className="prose">
          <p>
            Once deployed, query views through the SDK or CLI. The query API
            supports filtering, comparison operators, ordering, pagination, and
            field selection.
          </p>
        </div>

        <CodeBlock lang="typescript" code={`// Via SDK
const { data, meta } = await client.views.queryTable(
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
const { data } = await client.views.queryTable(
  "token-transfers",
  "transfers",
  { filters: { "amount.gte": "1000000" } }
)

// Get row count
const { count } = await client.views.queryTableCount(
  "token-transfers",
  "transfers",
  { filters: { sender: "SP1234..." } }
)

// Via CLI
sl views query token-transfers transfers --sort _block_height --order desc --limit 25
sl views query token-transfers transfers --filter sender=SP1234... --count`} />

        <SectionHeading id="typed-client">Typed client</SectionHeading>

        <div className="prose">
          <p>
            The SDK can infer TypeScript types from your view definition,
            giving you typed queries with autocompletion for table names,
            column names, and filter operators.
          </p>
        </div>

        <CodeBlock lang="typescript" code={`import { getView } from "@secondlayer/sdk"
import myView from "./views/token-transfers"

const client = getView(myView, { apiKey: "sk-sl_..." })

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
const typed = client.views.typed(myView)
const rows = await typed.transfers.findMany({ ... })`} />

        <SectionHeading id="search">Search</SectionHeading>

        <div className="prose">
          <p>
            Enable full-text search on any text column with the{" "}
            <code>search: true</code> flag. This creates a PostgreSQL trigram
            index (pg_trgm) for fast fuzzy matching.
          </p>
        </div>

        <CodeBlock code={`schema: {
  contracts: {
    columns: {
      name: { type: "text", search: true },
      deployer: { type: "principal", indexed: true },
    },
  },
}

// Query with search via REST API
const { data } = await client.views.queryTable("contracts", "contracts", {
  search: "token",
})`} />

        <SectionHeading id="deploy">Deploy</SectionHeading>

        <div className="prose">
          <p>
            Deploy views via the CLI. The CLI bundles your handler code with
            esbuild and posts it to the API. Schema changes are diffed
            automatically — additive changes are applied in place, breaking
            changes require a reindex.
          </p>
        </div>

        <CodeBlock lang="bash" code={`# Deploy to Second Layer
sl views deploy views/token-transfers.ts

# Dev mode — watches for changes, auto-redeploys
sl views dev views/token-transfers.ts

# Force reindex (drops and recreates schema)
sl views reindex token-transfers

# Reindex from a specific block range
sl views reindex token-transfers --from 150000 --to 160000

# Scaffold a view from a deployed contract's ABI
sl views scaffold SP1234...::my-contract --output views/my-contract.ts`} />

        <SectionHeading id="props">Props</SectionHeading>

        <div className="props-section">
          <div className="props-group-title">defineView</div>

          <div className="prop-row">
            <span className="prop-name">name</span>
            <span className="prop-type">string</span>
            <span className="prop-required">required</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">version</span>
            <span className="prop-type">number</span>
            <span className="prop-default">1</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">description</span>
            <span className="prop-type">string</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">sources</span>
            <span className="prop-type">ViewSource[]</span>
            <span className="prop-required">required</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">schema</span>
            <span className="prop-type">Record&lt;string, ViewTable&gt;</span>
            <span className="prop-required">required</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">handlers</span>
            <span className="prop-type">Record&lt;string, ViewHandler&gt;</span>
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

          <div className="props-group-title">ViewSource</div>

          <div className="prop-row">
            <span className="prop-name">type</span>
            <span className="prop-type">string</span>
            <span className="prop-default">transaction type filter</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">contract</span>
            <span className="prop-type">string</span>
            <span className="prop-default">supports wildcards</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">function</span>
            <span className="prop-type">string</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">event</span>
            <span className="prop-type">string</span>
          </div>
          <div className="prop-row">
            <span className="prop-name">minAmount</span>
            <span className="prop-type">number</span>
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
