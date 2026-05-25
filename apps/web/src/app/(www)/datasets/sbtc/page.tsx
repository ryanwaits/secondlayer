import { DatasetSandbox } from "@/components/dataset-sandbox";
import { ParquetSnippet } from "@/components/parquet-snippet";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "sBTC Dataset | secondlayer",
	description:
		"Every sBTC deposit, withdrawal, and SIP-010 token movement on Stacks. Stable schema, REST API, parquet downloads.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Source", href: "#source" },
	{ label: "Tables", href: "#tables" },
	{ label: "API", href: "#api" },
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
					contracts plus the SIP-010 token movements on <code>sbtc-token</code>.
					It is the canonical reference for sBTC supply, deposit and withdrawal
					lifecycle, and signer-set rotations.
				</p>
				<p>
					Topics are kept verbatim (kebab-case) to match the on-chain print
					payloads. Field names are decoded into snake_case columns for
					ergonomic SQL. Cross-chain joins use <code>bitcoin_txid</code>.
				</p>
			</div>

			<SectionHeading id="source">Source</SectionHeading>

			<div className="prose">
				<p>Decoded from canonical Stacks Streams events on two contracts:</p>
				<ul>
					<li>
						<code>SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry</code>{" "}
						— protocol-state print events
					</li>
					<li>
						<code>SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token</code> —
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
					given topic are null. Topic discriminator:{" "}
					<code>completed-deposit</code>, <code>withdrawal-create</code>,{" "}
					<code>withdrawal-accept</code>, <code>withdrawal-reject</code>,{" "}
					<code>key-rotation</code>, <code>update-protocol-contract</code>.
				</p>
				<p>
					<strong>
						<code>sbtc_token_events</code>
					</strong>{" "}
					— one row per SIP-010 event on <code>sbtc-token</code>: transfer /
					mint / burn.
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
					<code>GET /v1/datasets/sbtc/events</code> — registry events. Filters:{" "}
					<code>topic</code>, <code>sender</code>, <code>bitcoin_txid</code>,{" "}
					<code>from_block</code>, <code>to_block</code>. Pagination via{" "}
					<code>cursor</code>. For bulk pulls, use the parquet shelf below.
				</p>
			</div>

			<DatasetSandbox
				endpoint="/v1/datasets/sbtc/events"
				title="Try sbtc/events"
				filters={[
					{
						name: "topic",
						type: "enum",
						options: [
							"completed-deposit",
							"withdrawal-create",
							"withdrawal-accept",
							"withdrawal-reject",
							"key-rotation",
							"update-protocol-contract",
						],
						default: "completed-deposit",
					},
					{ name: "limit", type: "number", default: "5", placeholder: "5" },
					{ name: "sender", type: "string", placeholder: "SP1..." },
					{
						name: "bitcoin_txid",
						type: "string",
						placeholder: "0xa1b2...",
					},
					{ name: "from_block", type: "number", placeholder: "7800000" },
					{ name: "to_block", type: "number", placeholder: "7900000" },
				]}
				sample={{
					events: [
						{
							cursor: "7869999:42",
							block_height: 7869999,
							block_time: "2026-05-05T12:34:56.000Z",
							tx_id: "0xabc…",
							topic: "completed-deposit",
							amount: "100000000",
							bitcoin_txid: "0xa1b2…",
						},
					],
					next_cursor: "7870001:7",
					tip: { block_height: 7879089 },
				}}
			/>

			<ParquetSnippet
				dataset="sbtc/events"
				title="sbtc/events"
				description="Protocol-state events: completed-deposit, withdrawal-create / accept / reject, key-rotation, update-protocol-contract."
			/>

			<ParquetSnippet
				dataset="sbtc/token-events"
				title="sbtc/token-events"
				description="SIP-010 movements on sbtc-token: transfer, mint, burn."
			/>

			<SectionHeading id="parquet">Parquet</SectionHeading>

			<div className="prose">
				<p>
					sBTC ships as two parquet families under one prefix.{" "}
					<code>events/</code> covers protocol-state events (deposits,
					withdrawals, signer rotations, governance); <code>token-events/</code>{" "}
					covers SIP-010 movements on <code>sbtc-token</code>. Both are
					partitioned by 10,000-block range, with per-family manifests.
				</p>
				<p>Object prefix:</p>
			</div>

			<InlineCodeBlock>
				{`stacks-datasets/mainnet/v0/sbtc/events/data/block_height/<range>/data.parquet
stacks-datasets/mainnet/v0/sbtc/events/manifest/latest.json
stacks-datasets/mainnet/v0/sbtc/events/schema.json
stacks-datasets/mainnet/v0/sbtc/token-events/data/block_height/<range>/data.parquet
stacks-datasets/mainnet/v0/sbtc/token-events/manifest/latest.json
stacks-datasets/mainnet/v0/sbtc/token-events/schema.json`}
			</InlineCodeBlock>

			<div className="prose">
				<p>DuckDB:</p>
			</div>

			<InlineCodeBlock>
				{`SELECT topic, count(*) AS n
FROM read_parquet(
  'https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-datasets/mainnet/v0/sbtc/events/data/block_height/*/data.parquet'
)
GROUP BY topic
ORDER BY n DESC;`}
			</InlineCodeBlock>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes{" "}
					<code>sbtc-events</code> and <code>sbtc-token-events</code> entries
					with <code>latest_finalized_cursor</code>, <code>generated_at</code>,
					and <code>lag_blocks</code> against the chain tip. Expect ~10K + 144
					blocks of lag in steady state.
				</p>
				<p>
					Schema doc: <code>docs/datasets/sbtc/schema.md</code>.
				</p>
			</div>
		</main>
	);
}
