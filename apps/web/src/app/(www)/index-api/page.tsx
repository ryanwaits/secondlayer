import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { IndexDiagram } from "@/components/diagrams/index-diagram";
import { InlineKey, KeyTrigger } from "@/components/inline-key";
import { MarketingPageHeader } from "@/components/marketing-page-header";
import { SectionHeading } from "@/components/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Index | secondlayer",
	description:
		"Decoded Stacks events and contract calls — normalized, filterable, cursor-paginated. No decoders to write.",
};

export default function IndexPage() {
	return (
		<main className="explore-wrap">
			<MarketingPageHeader
				crumb="Home"
				crumbHref="/"
				here="Index"
				title={<>Index</>}
			/>
			<div className="mk-body">
				<div className="prose">
					<p>
						Index is the decoded read layer for Stacks. An L2 decoder consumes
						the raw <Link href="/streams">Streams</Link> firehose and normalizes
						every event type — STX, FT, and NFT transfers, mints and burns, and{" "}
						<code>print</code> events — plus contract calls, into typed,
						queryable rows. Filter by contract, wallet, or block range — per
						event type — with no decoders to write or maintain.
					</p>
					<InlineKey product="index">
						Reads are open during beta — anonymous works, and an{" "}
						<KeyTrigger>API key</KeyTrigger> just raises your rate limit.
					</InlineKey>
					<p>
						For your own app-specific shape, see{" "}
						<Link href="/subgraphs">Subgraphs</Link>; for raw events, see{" "}
						<Link href="/streams">Streams</Link>.
					</p>
				</div>

				<SectionHeading id="how-it-works">How it works</SectionHeading>

				<IndexDiagram />

				<div className="prose">
					<p>
						The decoder reads Streams and writes normalized rows for every
						decoded <code>event_type</code>; contract calls come straight from
						the transaction record with their arguments and result decoded. The
						Index API serves them, filtered and cursor-paginated. Decoding
						happens once, on shared infra — you just query.
					</p>
				</div>

				<SectionHeading id="querying">Querying</SectionHeading>

				<div className="prose">
					<p>
						<code>/v1/index/events?event_type=…</code> serves every decoded
						event type, and <code>/v1/index/contract-calls</code> serves decoded
						contract calls. Filter by <code>contract_id</code>,{" "}
						<code>sender</code>/<code>recipient</code>, and block range, and
						page forward on a <code>cursor</code> — each event type accepts only
						the filters that make sense for it (<code>stx_transfer</code> has no{" "}
						<code>contract_id</code>; mints filter by recipient, not sender).{" "}
						<code>GET /v1/index</code> returns the exact per-type filter
						vocabulary. (<code>ft-transfers</code> and{" "}
						<code>nft-transfers</code> remain as typed aliases.) The SDK wraps
						list + cursor-walking:
					</p>
				</div>

				<CodeBlock
					code={`import { Index } from "@secondlayer/sdk";

const index = new Index({ apiKey: process.env.SL_INDEX_API_KEY });

// One page of decoded events for any type
const { events, next_cursor } = await index.events.list({
  eventType: "stx_transfer",
  sender: "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
  limit: 50,
});

// Or stream every contract call to a contract across pages
for await (const call of index.contractCalls.walk({ contractId })) {
  await handle(call);
}`}
				/>

				<Callout label="Full reference">
					<p>
						Every field, the rate tiers, and the NFT endpoint live in the docs →{" "}
						<Link href="/docs/index">/docs/index</Link>.
					</p>
				</Callout>


			</div>
		</main>
	);
}
