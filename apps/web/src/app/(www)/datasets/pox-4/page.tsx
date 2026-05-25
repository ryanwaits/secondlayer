import { DatasetSandbox } from "@/components/dataset-sandbox";
import { ParquetSnippet } from "@/components/parquet-snippet";
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

			<DatasetSandbox
				endpoint="/v1/datasets/pox-4/calls"
				title="Try pox-4/calls"
				sample={{
					calls: [
						{
							cursor: "7869999:4",
							block_height: 7869999,
							function_name: "stack-stx",
							stacker: "SP1…",
							amount_ustx: "100000000000",
							start_cycle: 87,
							end_cycle: 92,
							result_ok: true,
						},
					],
					next_cursor: "7870001:0",
					tip: { block_height: 7889408 },
				}}
				filters={[
					{
						name: "function_name",
						type: "enum",
						options: [
							"stack-stx",
							"stack-extend",
							"stack-increase",
							"delegate-stx",
							"revoke-delegate-stx",
							"delegate-stack-stx",
							"delegate-stack-extend",
							"delegate-stack-increase",
							"stack-aggregation-commit",
							"stack-aggregation-commit-indexed",
							"stack-aggregation-increase",
							"set-signer-key-authorization",
						],
						default: "stack-stx",
					},
					{ name: "limit", type: "number", default: "5", placeholder: "5" },
					{ name: "stacker", type: "string", placeholder: "SP1..." },
					{ name: "delegate_to", type: "string", placeholder: "SP2..." },
					{ name: "signer_key", type: "string", placeholder: "0x..." },
					{ name: "reward_cycle", type: "number", placeholder: "87" },
				]}
			/>

			<SectionHeading id="parquet">Parquet</SectionHeading>

			<div className="prose">
				<p>
					Same data as the API, distributed as parquet for bulk pulls. Files are
					partitioned by 10,000-block range. Manifest lists every published file
					with row counts and SHA-256.
				</p>
			</div>

			<ParquetSnippet
				dataset="pox-4/calls"
				title="pox-4/calls"
				description="One row per successful PoX-4 contract call across all 12 supported functions."
			/>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes a{" "}
					<code>pox-4-calls</code> entry with{" "}
					<code>latest_finalized_cursor</code>, <code>generated_at</code>, and{" "}
					<code>lag_blocks</code> against the chain tip.
				</p>
				<p>
					Schema doc: <code>docs/datasets/pox-4/schema.md</code>.
				</p>
			</div>
		</main>
	);
}
