import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Network Health Dataset | secondlayer",
	description:
		"Daily rollups of canonical block count, average block time, and reorg counts on Stacks.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "API", href: "#api" },
	{ label: "Schema", href: "#schema" },
	{ label: "Notes", href: "#notes" },
];

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

export default function NetworkHealthDatasetPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Network Health" toc={toc} />
			<NetworkHealthDatasetContent />
		</div>
	);
}

export function NetworkHealthDatasetContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">Network Health</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					Daily rollups of canonical Stacks chain activity: how many blocks
					were produced, the average block-time gap, and how many reorgs were
					detected.
				</p>
				<p>
					Computed on demand from <code>blocks</code> and{" "}
					<code>chain_reorgs</code>. No decoder, no separate aggregation table
					yet — small enough to derive in the request path.
				</p>
			</div>

			<SectionHeading id="api">API</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/datasets/network-health/summary?days=30</code>
				</p>
				<p>
					Returns one row per UTC date covered by the requested window. Default
					30 days, max 365.
				</p>
			</div>

			<InlineCodeBlock>
				{`curl "https://api.secondlayer.dev/v1/datasets/network-health/summary?days=7"`}
			</InlineCodeBlock>

			<InlineCodeBlock>
				{`{
  "days": [
    {
      "date": "2026-05-05",
      "block_count": 8602,
      "avg_block_time_seconds": 10.04,
      "reorg_count": 0
    }
  ],
  "tip": { "block_height": 7501982 }
}`}
			</InlineCodeBlock>

			<SectionHeading id="schema">Schema</SectionHeading>

			<div className="prose">
				<table>
					<thead>
						<tr>
							<th>Column</th>
							<th>Type</th>
							<th>Description</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>
								<code>date</code>
							</td>
							<td>string</td>
							<td>UTC calendar date, YYYY-MM-DD</td>
						</tr>
						<tr>
							<td>
								<code>block_count</code>
							</td>
							<td>number</td>
							<td>Canonical Stacks blocks produced that day</td>
						</tr>
						<tr>
							<td>
								<code>avg_block_time_seconds</code>
							</td>
							<td>number | null</td>
							<td>Average gap between consecutive canonical blocks</td>
						</tr>
						<tr>
							<td>
								<code>reorg_count</code>
							</td>
							<td>number</td>
							<td>
								Reorgs detected by the indexer that day (rows in{" "}
								<code>chain_reorgs</code>)
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<SectionHeading id="notes">Notes</SectionHeading>

			<div className="prose">
				<ul>
					<li>
						v0 has no parquet path. The dataset is small (~1 row per day) and
						cheap to recompute. Parquet export will land alongside other
						datasets if there is real demand.
					</li>
					<li>
						Reorg detection is the Stacks Streams indexer&apos;s view; it counts
						any time a previously-canonical block was orphaned in favor of a
						longer fork.
					</li>
					<li>
						Block time gaps span fast blocks (~10s) plus tenure boundaries.
						Expect averages near 10s; spikes correlate with miner outages or
						Bitcoin block delays.
					</li>
				</ul>
			</div>
		</main>
	);
}
