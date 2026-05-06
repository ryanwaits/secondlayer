import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "STX Transfers Dataset | secondlayer",
	description:
		"Every canonical STX transfer event on Stacks. Stable schema, parquet downloads, dashboard view.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Schema", href: "#schema" },
	{ label: "Read API", href: "#read-api" },
	{ label: "Parquet", href: "#parquet" },
	{ label: "Freshness", href: "#freshness" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function StxTransfersDatasetPage() {
	return (
		<div className="article-layout">
			<Sidebar title="STX Transfers" toc={toc} />
			<StxTransfersDatasetContent />
		</div>
	);
}

export function StxTransfersDatasetContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">STX Transfers</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					Every canonical STX transfer event on Stacks. Sender, recipient,
					amount in microSTX, and the optional hex-encoded memo. Sourced
					directly from canonical L1 events — no decoder, no waiting.
				</p>
				<p>
					Use the read API for dashboards and ad-hoc queries. Use parquet for
					historical analytics and warehouse loads.
				</p>
			</div>

			<SectionHeading id="schema">Schema</SectionHeading>

			<div className="prose">
				<p>
					Schema version <code>v0</code>. The canonical contract:
				</p>
				<table>
					<thead>
						<tr>
							<th>Column</th>
							<th>Type</th>
							<th>Nullable</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<code>cursor</code>
							</td>
							<td>string</td>
							<td>no</td>
							<td>
								<code>&lt;block_height&gt;:&lt;event_index&gt;</code>
							</td>
						</tr>
						<tr>
							<td>
								<code>block_height</code>
							</td>
							<td>int64</td>
							<td>no</td>
							<td>Canonical Stacks block height</td>
						</tr>
						<tr>
							<td>
								<code>block_time</code>
							</td>
							<td>string</td>
							<td>no</td>
							<td>ISO-8601 UTC timestamp</td>
						</tr>
						<tr>
							<td>
								<code>tx_id</code>
							</td>
							<td>string</td>
							<td>no</td>
							<td>Parent transaction id</td>
						</tr>
						<tr>
							<td>
								<code>tx_index</code>
							</td>
							<td>int32</td>
							<td>no</td>
							<td>Parent transaction position in block</td>
						</tr>
						<tr>
							<td>
								<code>event_index</code>
							</td>
							<td>int32</td>
							<td>no</td>
							<td>Streams event index in block</td>
						</tr>
						<tr>
							<td>
								<code>sender</code>
							</td>
							<td>string</td>
							<td>no</td>
							<td>STX sender address</td>
						</tr>
						<tr>
							<td>
								<code>recipient</code>
							</td>
							<td>string</td>
							<td>no</td>
							<td>STX recipient address</td>
						</tr>
						<tr>
							<td>
								<code>amount</code>
							</td>
							<td>string</td>
							<td>no</td>
							<td>microSTX as decimal string (u128)</td>
						</tr>
						<tr>
							<td>
								<code>memo</code>
							</td>
							<td>string</td>
							<td>yes</td>
							<td>Hex-encoded memo if present</td>
						</tr>
					</tbody>
				</table>
			</div>

			<SectionHeading id="read-api">Read API</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/datasets/stx-transfers</code>
				</p>
				<p>Filters: <code>sender</code>, <code>recipient</code>, <code>from_block</code>, <code>to_block</code>. Pagination: <code>cursor</code>.</p>
			</div>

			<InlineCodeBlock>
				{`curl "https://api.secondlayer.dev/v1/datasets/stx-transfers?sender=SP1...&limit=100"`}
			</InlineCodeBlock>

			<div className="prose">
				<p>Response shape:</p>
			</div>

			<InlineCodeBlock>
				{`{
  "events": [
    {
      "cursor": "189999:42",
      "block_height": 189999,
      "block_time": "2026-05-05T12:34:56.000Z",
      "tx_id": "0xabc...",
      "tx_index": 12,
      "event_index": 42,
      "sender": "SP1...",
      "recipient": "SP2...",
      "amount": "1000000",
      "memo": null
    }
  ],
  "next_cursor": "190001:7",
  "tip": { "block_height": 195000 }
}`}
			</InlineCodeBlock>

			<SectionHeading id="parquet">Parquet</SectionHeading>

			<div className="prose">
				<p>
					Parquet files are partitioned by 10,000-block range. The manifest
					lists every published file with row count and SHA-256.
				</p>
				<p>Object prefix:</p>
			</div>

			<InlineCodeBlock>
				{`stacks-datasets/mainnet/v0/stx-transfers/data/block_height/<range>/data.parquet
stacks-datasets/mainnet/v0/stx-transfers/manifest/latest.json
stacks-datasets/mainnet/v0/stx-transfers/schema.json`}
			</InlineCodeBlock>

			<div className="prose">
				<p>DuckDB:</p>
			</div>

			<InlineCodeBlock>
				{`SELECT recipient, sum(amount::DECIMAL) AS total
FROM read_parquet(
  'https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-datasets/mainnet/v0/stx-transfers/data/block_height/*/data.parquet'
)
GROUP BY recipient
ORDER BY total DESC
LIMIT 20;`}
			</InlineCodeBlock>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes a <code>stx-transfers</code> entry with{" "}
					<code>latest_finalized_cursor</code>, <code>generated_at</code>, and{" "}
					<code>lag_blocks</code> against the chain tip. Expect ~10K + 144
					blocks of lag in steady state.
				</p>
			</div>
		</main>
	);
}
