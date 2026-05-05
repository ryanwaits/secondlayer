import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Stacks Index | secondlayer",
	description: "Decoded FT and NFT transfer events for Stacks apps.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Auth", href: "#auth" },
	{ label: "FT transfers", href: "#ft-transfers" },
	{ label: "NFT transfers", href: "#nft-transfers" },
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

export default function StacksIndexPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Stacks Index" toc={toc} />

			<StacksIndexContent />
		</div>
	);
}

export function StacksIndexContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">Stacks Index</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					Stacks Index is the L2 read surface for decoded chain events. It
					starts with fungible token and NFT transfer history, normalized from
					Stacks Streams.
				</p>
				<p>
					Use Stacks Index when you want token and NFT transfer rows without
					running ABI decoders or replaying raw L1 events yourself.
				</p>
			</div>

			<SectionHeading id="auth">Auth</SectionHeading>

			<div className="prose">
				<p>
					Use a paid API key with <code>index:read</code>. Send it as a bearer
					token on every request.
				</p>
			</div>

			<InlineCodeBlock>
				{`curl https://api.secondlayer.tools/v1/index/ft-transfers \\
  -H "Authorization: Bearer sk-sl_..."`}
			</InlineCodeBlock>

			<SectionHeading id="ft-transfers">FT transfers</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/index/ft-transfers</code> returns decoded SIP-010
					transfer rows. Filters: <code>cursor</code>, <code>from_cursor</code>,{" "}
					<code>limit</code>, <code>contract_id</code>, <code>sender</code>,{" "}
					<code>recipient</code>, <code>from_height</code>, and{" "}
					<code>to_height</code>.
				</p>
			</div>

			<InlineCodeBlock>
				{`{
  "events": [{
    "cursor": "182431:14",
    "event_type": "ft_transfer",
    "contract_id": "SP...sbtc-token",
    "asset_identifier": "SP...sbtc-token::sbtc",
    "sender": "SP...",
    "recipient": "SP...",
    "amount": "250000"
  }],
  "next_cursor": "182431:15",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": []
}`}
			</InlineCodeBlock>

			<InlineCodeBlock>
				{`import { SecondLayer } from "@secondlayer/sdk"

const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_API_KEY! })

const ft = await sl.index.ftTransfers.list({
  contractId: "SP...sbtc-token",
  limit: 100,
})

const nft = await sl.index.nftTransfers.list({
  assetIdentifier: "SP...collection::token",
  limit: 100,
})

console.log(ft.events.length, nft.events.length)`}
			</InlineCodeBlock>

			<SectionHeading id="nft-transfers">NFT transfers</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/index/nft-transfers</code> returns decoded SIP-009
					transfer rows. Filters: <code>cursor</code>, <code>from_cursor</code>,{" "}
					<code>limit</code>, <code>contract_id</code>, <code>sender</code>,{" "}
					<code>recipient</code>, <code>asset_identifier</code>,{" "}
					<code>from_height</code>, and <code>to_height</code>.
				</p>
				<p>
					<code>value</code> is the raw Clarity-serialized token identifier as a
					hex string. v1 does not decode it into JSON.
				</p>
			</div>

			<InlineCodeBlock>
				{`{
  "events": [{
    "cursor": "182431:18",
    "event_type": "nft_transfer",
    "asset_identifier": "SP...collection::token",
    "sender": "SP...",
    "recipient": "SP...",
    "value": "0x..."
  }],
  "next_cursor": "182431:19",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": []
}`}
			</InlineCodeBlock>

			<SectionHeading id="pagination">Pagination</SectionHeading>

			<div className="prose">
				<p>
					Cursors match Stacks Streams:{" "}
					<code>{"<block_height>:<event_index>"}</code>. Call again with{" "}
					<code>cursor=next_cursor</code>. For history backfills, use SDK walk
					helpers.
				</p>
			</div>

			<InlineCodeBlock>
				{`import { SecondLayer } from "@secondlayer/sdk"

const sl = new SecondLayer({ apiKey: process.env.SECONDLAYER_API_KEY! })

for await (const transfer of sl.index.ftTransfers.walk({
  contractId: "SP...sbtc-token",
  fromHeight: 0,
  batchSize: 500,
})) {
  console.log(transfer.cursor, transfer.amount)
}

for await (const transfer of sl.index.nftTransfers.walk({
  assetIdentifier: "SP...collection::token",
  fromHeight: 0,
  batchSize: 500,
})) {
  console.log(transfer.cursor, transfer.value)
}`}
			</InlineCodeBlock>

			<SectionHeading id="reorgs">Reorgs</SectionHeading>

			<div className="prose">
				<p>
					Every Index response includes top-level <code>reorgs</code>. The
					array is populated only when the returned cursor range overlaps
					recorded reorg metadata; otherwise it is <code>reorgs: []</code>.
					Treat it like the Stacks Streams envelope and invalidate downstream
					state in the affected cursor range.
				</p>
			</div>
		</main>
	);
}
