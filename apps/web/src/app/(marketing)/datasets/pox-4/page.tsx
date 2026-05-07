import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "PoX-4 Stacking Dataset | secondlayer",
	description:
		"Every Stacks PoX-4 contract call decoded — solo stacking, delegation, aggregation, signer authorizations. Stable schema, REST API.",
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

export default function Pox4DatasetPage() {
	return (
		<div className="article-layout">
			<Sidebar title="PoX-4 / Stacking" toc={toc} />
			<Pox4DatasetContent />
		</div>
	);
}

export function Pox4DatasetContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">PoX-4 / Stacking</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					The PoX-4 dataset captures every Stacking lifecycle call on Stacks —
					solo stacking, delegation, extension, increase, revocation,
					aggregation, and signer-key authorizations. It is the canonical
					reference for "who is stacking, how much, in which cycle, with what
					BTC payout address, and which signer key."
				</p>
				<p>
					Cursor is <code>&lt;block_height&gt;:&lt;tx_index&gt;</code> — PoX-4
					is transaction-grain, not event-grain, because the contract returns
					state through <code>(ok ...)</code> response tuples and emits no
					prints.
				</p>
			</div>

			<SectionHeading id="source">Source</SectionHeading>

			<div className="prose">
				<p>
					Decoded directly from canonical successful transactions against the
					PoX-4 contract:
				</p>
				<ul>
					<li>
						<code>SP000000000000000000002Q6VF78.pox-4</code> (mainnet)
					</li>
				</ul>
				<p>
					Function args and <code>raw_result</code> are deserialized via
					Clarity. PoX address tuples are decoded into canonical Bitcoin address
					strings. Cycle math uses Nakamoto activation constants (first
					burnchain block <code>666050</code>, reward cycle length{" "}
					<code>2100</code>).
				</p>
				<p>
					Forward-only ingestion from the moment the decoder enabled —
					historical cycles before activation are out of scope.
				</p>
			</div>

			<SectionHeading id="tables">Tables</SectionHeading>

			<div className="prose">
				<p>
					<strong>
						<code>pox4_calls</code>
					</strong>{" "}
					— one row per successful PoX-4 call. Wide schema; columns not relevant
					to a given function are null. Function discriminator covers all 12
					supported calls:
				</p>
				<ul>
					<li>
						Solo: <code>stack-stx</code>, <code>stack-extend</code>,{" "}
						<code>stack-increase</code>
					</li>
					<li>
						Delegation: <code>delegate-stx</code>,{" "}
						<code>revoke-delegate-stx</code>, <code>delegate-stack-stx</code>,{" "}
						<code>delegate-stack-extend</code>,{" "}
						<code>delegate-stack-increase</code>
					</li>
					<li>
						Aggregation: <code>stack-aggregation-commit</code>,{" "}
						<code>stack-aggregation-commit-indexed</code>,{" "}
						<code>stack-aggregation-increase</code>
					</li>
					<li>
						Signer auth: <code>set-signer-key-authorization</code>
					</li>
				</ul>
				<p>
					Daily rollups (<code>pox4_cycles_daily</code>,{" "}
					<code>pox4_signers_daily</code>) are deferred to a follow-up
					aggregator job.
				</p>
			</div>

			<SectionHeading id="api">API</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/datasets/pox-4/calls</code> — PoX-4 calls. Filters:{" "}
					<code>function_name</code>, <code>stacker</code>,{" "}
					<code>delegate_to</code>, <code>signer_key</code>,{" "}
					<code>reward_cycle</code>, <code>from_block</code>,{" "}
					<code>to_block</code>. Pagination via <code>cursor</code>.
				</p>
			</div>

			<InlineCodeBlock>
				{`curl "https://api.secondlayer.tools/v1/datasets/pox-4/calls?function_name=stack-stx&limit=5"`}
			</InlineCodeBlock>

			<div className="prose">
				<p>Response:</p>
			</div>

			<InlineCodeBlock>
				{`{
  "calls": [
    {
      "cursor": "7869999:4",
      "block_height": 7869999,
      "block_time": "2026-05-05T12:34:56.000Z",
      "burn_block_height": 902481,
      "tx_id": "0xabc...",
      "tx_index": 4,
      "function_name": "stack-stx",
      "caller": "SP1...",
      "stacker": "SP1...",
      "amount_ustx": "100000000000",
      "lock_period": 6,
      "pox_addr_version": 4,
      "pox_addr_hashbytes": "0x000102...",
      "pox_addr_btc": "bc1q...",
      "start_cycle": 87,
      "end_cycle": 92,
      "signer_key": "0x03ab...",
      "auth_id": "1",
      "max_amount": "200000000000",
      "result_ok": true
    }
  ],
  "next_cursor": "7870001:0",
  "tip": { "block_height": 7889408 }
}`}
			</InlineCodeBlock>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes a{" "}
					<code>pox-4-calls</code> entry with{" "}
					<code>latest_finalized_cursor</code>, <code>generated_at</code>, and{" "}
					<code>lag_blocks</code> against the chain tip. Parquet exporter is
					deferred — the API is the primary surface for v0.
				</p>
				<p>
					Schema doc: <code>docs/datasets/pox-4/schema.md</code>.
				</p>
			</div>
		</main>
	);
}
