import { BoxBadge } from "@/components/box-badge";
import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SubgraphsDiagram } from "@/components/diagrams/subgraphs-diagram";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import { MARKETING_SUBGRAPHS_PROMPT } from "@/lib/agent-prompts";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Stacks Subgraphs | secondlayer",
	description:
		"Your own indexer, minus the node. Write handlers, get typed Postgres tables shaped exactly for your app.",
};

const toc: TocItem[] = [
	{ label: "How it works", href: "#how-it-works" },
	{ label: "Define a subgraph", href: "#define" },
	{ label: "Deploy & query", href: "#deploy" },
];

export default function SubgraphsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Stacks Subgraphs" toc={toc} />

			<main className="content-area">
				<header className="page-header">
					<h1 className="page-title">
						Stacks Subgraphs <BoxBadge>Beta</BoxBadge>
					</h1>
				</header>

				<div className="prose">
					<p>
						Subgraphs are your own indexer, minus the node. Pick the events your
						app needs, write handlers, and get typed Postgres tables shaped
						exactly for your product — queryable over a REST API, the SDK, or a
						generated typed client.
					</p>
					<p>
						It's the L3 surface: where <a href="/streams">raw events</a> become
						the data <em>your</em> app actually wants. Install with{" "}
						<code>bun add @secondlayer/subgraphs</code>.
					</p>
				</div>

				<AgentPromptBlock
					title="Set up subgraphs with your agent."
					code={MARKETING_SUBGRAPHS_PROMPT}
					collapsible
				/>

				<SectionHeading id="how-it-works">How it works</SectionHeading>

				<SubgraphsDiagram />

				<div className="prose">
					<p>
						The runtime feeds matched events into your handlers per block; the
						handlers write rows into your own schema. No node, no backfill
						scripts — redeploy and it reindexes for you.
					</p>
				</div>

				<SectionHeading id="define">Define a subgraph</SectionHeading>

				<div className="prose">
					<p>
						A subgraph has three parts: <strong>sources</strong> (what events to
						listen for), a <strong>schema</strong> (what tables to create), and{" "}
						<strong>handlers</strong> (how to turn each event into rows). Writes
						are batched and flushed atomically per block.
					</p>
				</div>

				<CodeBlock
					code={`import { defineSubgraph } from "@secondlayer/subgraphs";

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
      });
    },
  },
});`}
				/>

				<div className="prose">
					<p>
						Each subgraph gets its own Postgres schema with system columns added
						automatically (<code>_id</code>, <code>_block_height</code>,{" "}
						<code>_tx_id</code>, <code>_created_at</code>). The full column-type
						list, the handler context API (<code>upsert</code>,{" "}
						<code>findOne</code>, aggregates), and monitoring patterns are in
						the docs.
					</p>
				</div>

				<SectionHeading id="deploy">Deploy &amp; query</SectionHeading>

				<div className="prose">
					<p>
						Scaffold from a contract's ABI, deploy, and query — via the CLI, the
						SDK, or the generated typed client:
					</p>
				</div>

				<CodeBlock
					lang="bash"
					code={`# Scaffold from a deployed contract's ABI
sl subgraphs scaffold SP1234ABCD.token-transfers --output subgraphs/token-transfers.ts

# Deploy (or 'dev' to watch + auto-redeploy)
sl subgraphs deploy subgraphs/token-transfers.ts

# Generate a typed client (autocompletion + table types)
sl subgraphs generate token-transfers --output src/clients/token-transfers.ts`}
				/>

				<CodeBlock
					code={`// SDK — filters, comparison operators, ordering, pagination
const { data } = await client.subgraphs.queryTable(
  "token-transfers",
  "transfers",
  {
    sort: "_block_height",
    order: "desc",
    limit: 25,
    filters: { sender: "SP1234...", "amount.gte": "1000000" },
  },
);

// HTTP
// GET https://api.secondlayer.tools/api/subgraphs/token-transfers/transfers
//   ?_sort=_block_height&_order=desc&_limit=25&sender=SP1234...`}
				/>

				<Callout label="Full reference">
					<p>
						Column types, the full handler context API, monitoring patterns, and
						every HTTP route live in the docs →{" "}
						<a href="/docs/subgraphs">/docs/subgraphs</a>.
					</p>
				</Callout>
			</main>
		</div>
	);
}
