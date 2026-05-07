import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "sBTC Dataset | secondlayer",
	description:
		"Every sBTC deposit, withdrawal, and SIP-010 token movement on Stacks. Stable schema, REST API, future parquet downloads.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Source", href: "#source" },
	{ label: "Tables", href: "#tables" },
	{ label: "API", href: "#api" },
	{ label: "Freshness", href: "#freshness" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function SbtcDatasetPage() {
	return (
		<div className="article-layout">
			<Sidebar title="sBTC" toc={toc} />
			<SbtcDatasetContent />
		</div>
	);
}

export function SbtcDatasetContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">sBTC</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					The sBTC dataset captures every protocol-state event on the sBTC
					contracts plus the SIP-010 token movements on{" "}
					<code>sbtc-token</code>. It is the canonical reference for sBTC
					supply, deposit and withdrawal lifecycle, and signer-set rotations.
				</p>
				<p>
					Topics are kept verbatim (kebab-case) to match the on-chain print
					payloads. Field names are decoded into snake_case columns for
					ergonomic SQL. Cross-chain joins use{" "}
					<code>bitcoin_txid</code>.
				</p>
			</div>

			<SectionHeading id="source">Source</SectionHeading>

			<div className="prose">
				<p>Decoded from canonical Stacks Streams events on two contracts:</p>
				<ul>
					<li>
						<code>SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry</code>
						{" "}— protocol-state print events
					</li>
					<li>
						<code>SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token</code>{" "}—
						SIP-010 transfer / mint / burn events
					</li>
				</ul>
			</div>

			<SectionHeading id="tables">Tables</SectionHeading>

			<div className="prose">
				<p>
					<strong>
						<code>sbtc_events</code>
					</strong>{" "}
					— one row per registry event. Wide schema; columns not relevant to a
					given topic are null. Topic discriminator: <code>completed-deposit</code>,{" "}
					<code>withdrawal-create</code>, <code>withdrawal-accept</code>,{" "}
					<code>withdrawal-reject</code>, <code>key-rotation</code>,{" "}
					<code>update-protocol-contract</code>.
				</p>
				<p>
					<strong>
						<code>sbtc_token_events</code>
					</strong>{" "}
					— one row per SIP-010 event on <code>sbtc-token</code>: transfer / mint /
					burn.
				</p>
				<p>
					<strong>
						<code>sbtc_supply_snapshots</code>
					</strong>{" "}
					— daily rollup with end-of-day total supply (deferred to a follow-up
					rollup job).
				</p>
			</div>

			<SectionHeading id="api">API</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/datasets/sbtc/events</code> — protocol events.
					Filters: <code>topic</code>, <code>request_id</code>,{" "}
					<code>bitcoin_txid</code>, <code>sender</code>, <code>from_block</code>
					, <code>to_block</code>. Pagination via <code>cursor</code>.
				</p>
				<p>
					<code>GET /v1/datasets/sbtc/token-events</code> — SIP-010 events.
					Filters: <code>event_type</code> (transfer/mint/burn),{" "}
					<code>sender</code>, <code>recipient</code>.
				</p>
			</div>

			<InlineCodeBlock>
				{`curl "https://api.secondlayer.tools/v1/datasets/sbtc/events?topic=completed-deposit&limit=5"`}
			</InlineCodeBlock>

			<div className="prose">
				<p>Response:</p>
			</div>

			<InlineCodeBlock>
				{`{
  "events": [
    {
      "cursor": "7869999:42",
      "block_height": 7869999,
      "block_time": "2026-05-05T12:34:56.000Z",
      "tx_id": "0xabc...",
      "tx_index": 12,
      "event_index": 42,
      "topic": "completed-deposit",
      "amount": "100000000",
      "bitcoin_txid": "0xa1b2...",
      "output_index": 0,
      "sweep_txid": "0xc3d4...",
      "burn_hash": "0xe5f6...",
      "burn_height": 902481
    }
  ],
  "next_cursor": "7870001:7",
  "tip": { "block_height": 7879089 }
}`}
			</InlineCodeBlock>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes an{" "}
					<code>sbtc-events</code> entry with{" "}
					<code>latest_finalized_cursor</code>, <code>generated_at</code>, and{" "}
					<code>lag_blocks</code> against the chain tip.
				</p>
				<p>
					Parquet exporter is deferred — the API is the primary surface for v0.
					Schema doc: <code>docs/datasets/sbtc/schema.md</code>.
				</p>
			</div>
		</main>
	);
}
