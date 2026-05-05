import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Stacks Streams | secondlayer",
	description: "Raw ordered Stacks chain events for indexers and backfills.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Auth", href: "#auth" },
	{ label: "Events", href: "#events" },
	{ label: "Tip", href: "#tip" },
	{ label: "Canonical", href: "#canonical" },
	{ label: "Pagination", href: "#pagination" },
	{ label: "Reorgs", href: "#reorgs" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function StacksStreamsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Stacks Streams" toc={toc} />

			<StacksStreamsContent />
		</div>
	);
}

export function StacksStreamsContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">Stacks Streams</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					Stacks Streams is the L1 read surface for raw chain events. It is the
					lowest primitive Second Layer exposes: ordered events, stable cursors,
					and canonical block checks.
				</p>
				<p>
					Streams is read-only. It is for indexers, archives, backfills, and
					custom decoders. Decoded token history starts at Stacks Index.
				</p>
			</div>

			<SectionHeading id="auth">Auth</SectionHeading>

			<div className="prose">
				<p>
					Use an API key with <code>streams:read</code>. Send it as a bearer
					token on every request.
				</p>
			</div>

			<InlineCodeBlock>
				{`curl https://api.secondlayer.tools/v1/streams/events \\
  -H "Authorization: Bearer sk-sl_..."`}
			</InlineCodeBlock>

			<SectionHeading id="events">Events</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/streams/events</code> returns chain-emitted events in
					canonical order. Filters: <code>cursor</code>,{" "}
					<code>from_cursor</code>, <code>limit</code>, <code>types</code>,{" "}
					<code>contract_id</code>, <code>from_height</code>, and{" "}
					<code>to_height</code>.
				</p>
				<p>
					Use <code>GET /v1/streams/events/{"{tx_id}"}</code> for transaction
					events and{" "}
					<code>GET /v1/streams/blocks/{"{heightOrHash}"}/events</code> for
					block replay checks.
				</p>
			</div>

			<InlineCodeBlock>
				{`{
  "events": [{
    "cursor": "182431:14",
    "block_height": 182431,
    "index_block_hash": "0x...",
    "tx_id": "0x...",
    "event_index": 14,
    "event_type": "ft_transfer",
    "contract_id": "SP...sbtc-token",
    "payload": {}
  }],
  "next_cursor": "182431:15",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": []
}`}
			</InlineCodeBlock>

			<SectionHeading id="tip">Tip</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/streams/tip</code> returns current chain tip and ingest
					lag. Use it for health checks and dashboards.
				</p>
			</div>

			<InlineCodeBlock>
				{`{
  "block_height": 182447,
  "index_block_hash": "0x...",
  "burn_block_height": 871249,
  "lag_seconds": 3
}`}
			</InlineCodeBlock>

			<SectionHeading id="canonical">Canonical</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/streams/canonical/{"{height}"}</code> returns the
					canonical <code>index_block_hash</code> for a block height. External
					indexers use this to detect whether local state needs repair.
				</p>
			</div>

			<InlineCodeBlock>
				{`{
  "block_height": 182431,
  "index_block_hash": "0x...",
  "burn_block_height": 871233,
  "burn_block_hash": "0x...",
  "is_canonical": true
}`}
			</InlineCodeBlock>

			<SectionHeading id="pagination">Pagination</SectionHeading>

			<div className="prose">
				<p>
					Cursors use <code>{"<block_height>:<event_index>"}</code>. Call again
					with <code>cursor=next_cursor</code>. There is no offset pagination.
				</p>
			</div>

			<InlineCodeBlock>
				{`import { createStreamsClient } from "@secondlayer/sdk/streams"

const client = createStreamsClient({
  apiKey: process.env.SECONDLAYER_API_KEY!,
})

for await (const event of client.events.stream({
  fromCursor: "0:0",
  batchSize: 500,
  types: ["ft_transfer"],
})) {
  console.log(event.cursor, event.event_type)
}`}
			</InlineCodeBlock>

			<SectionHeading id="reorgs">Reorgs</SectionHeading>

			<div className="prose">
				<p>
					Every event response includes <code>reorgs: []</code>. When a reorg
					overlaps the response range, the envelope identifies the affected
					cursor range so clients can invalidate downstream state.
				</p>
				<p>
					<code>GET /v1/streams/reorgs?since=...</code> returns recorded reorg
					metadata ordered by detection time.
				</p>
			</div>
		</main>
	);
}
