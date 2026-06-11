import { BoxBadge } from "@/components/box-badge";
import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { AgentPromptBlock } from "@/components/console/agent-prompt";
import { SubgraphsDiagram } from "@/components/diagrams/subgraphs-diagram";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { SectionHeading } from "@/components/section-heading";
import { MARKETING_SUBGRAPHS_PROMPT } from "@/lib/agent-prompts";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Stacks Subgraphs | secondlayer",
	description:
		"Your own indexer, minus the node. Write handlers, get typed Postgres tables shaped exactly for your app.",
};

export default function SubgraphsPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader
				crumb="Home"
				crumbHref="/"
				here="Subgraphs"
				title={
					<>
						Subgraphs <BoxBadge>Beta</BoxBadge>
					</>
				}
			/>
			<div className="mk-body">
				<div className="prose">
					<p>
						Subgraphs are your own indexer, minus the node. Pick the events your
						app needs, write handlers, and get typed Postgres tables shaped
						exactly for your product — queryable over a REST API, the SDK, or a
						generated typed client.
					</p>
					<p>
						It's the L3 surface: where <Link href="/streams">raw events</Link>{" "}
						become the data <em>your</em> app actually wants. Install with{" "}
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

# Deploy
sl subgraphs deploy subgraphs/token-transfers.ts --visibility public

# Flip visibility later (managed deploys default public; BYO default private)
sl subgraphs publish token-transfers
sl subgraphs unpublish token-transfers

# Generate a typed client (autocompletion + table types)
sl subgraphs client token-transfers --output src/clients/token-transfers.ts`}
				/>

				<div className="prose">
					<p>
						Public subgraphs are anon-readable at{" "}
						<code>/v1/subgraphs/&lt;name&gt;</code> — names are a global
						namespace claimed on publish, and every public subgraph gets a live
						page on <Link href="/subgraphs/explore">Explore</Link>.
					</p>
				</div>

				<CodeBlock
					code={`// SDK — open /v1 read: filters, cursor pagination, no key for public subgraphs
const { rows, next_cursor, tip } = await client.subgraphs.rows(
  "token-transfers",
  "transfers",
  {
    order: "desc",
    limit: 25,
    filters: { sender: "SP1234...", "amount.gte": "1000000" },
  },
);

// HTTP — anon-readable for public subgraphs, { rows, next_cursor, tip } envelope
// GET https://api.secondlayer.tools/v1/subgraphs/token-transfers/transfers
//   ?_order=desc&_limit=25&sender=SP1234...`}
				/>

				<Callout label="Full reference">
					<p>
						Column types, the full handler context API, monitoring patterns, and
						every HTTP route live in the docs →{" "}
						<Link href="/docs/subgraphs">/docs/subgraphs</Link>.
					</p>
				</Callout>
			</div>
		</main>
	);
}
