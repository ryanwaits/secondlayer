import { DatasetSandbox } from "@/components/dataset-sandbox";
import { ParquetSnippet } from "@/components/parquet-snippet";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "BNS Dataset | secondlayer",
	description:
		"Every BNS-V2 name, namespace, and marketplace event on Stacks. Stable schema, REST API, current-state resolver.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "Source", href: "#source" },
	{ label: "Tables", href: "#tables" },
	{ label: "API", href: "#api" },
	{ label: "Resolver", href: "#resolver" },
	{ label: "Freshness", href: "#freshness" },
];

export default function BnsDatasetPage() {
	return (
		<div className="article-layout">
			<Sidebar title="BNS" toc={toc} />
			<BnsDatasetContent />
		</div>
	);
}

export function BnsDatasetContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">BNS</h1>
			</header>

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					The BNS dataset captures every name- and namespace-lifecycle event on
					BNS-V2, plus marketplace listings on the BNS-V2 NFT, plus a
					current-state projection answering "who owns <code>alice.btc</code>{" "}
					right now?" It is the canonical reference for BNS analytics and
					resolution at scale.
				</p>
				<p>
					BNS-V2 dispatches three different print payload shapes via three
					discriminator keys: <code>topic</code> for names, <code>status</code>{" "}
					for namespaces, <code>a</code> for marketplace. The decoder normalizes
					each shape into typed rows.
				</p>
			</div>

			<SectionHeading id="source">Source</SectionHeading>

			<div className="prose">
				<p>Decoded from canonical print events on the BNS-V2 contract:</p>
				<ul>
					<li>
						<code>SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2</code>{" "}
						(mainnet)
					</li>
				</ul>
				<p>
					<strong>Scope:</strong> BNS-V2 only. The BNS-V1 boot contract (
					<code>SP000000000000000000002Q6VF78.bns</code>) is not indexed. V1
					namespaces (<code>.btc</code>, <code>.id</code>, etc.) were imported
					into v2 at launch, so most live activity lands here, but ops that
					still happen on the v1 contract are not in these tables. Subdomain
					registrations and zonefile resolution are also out of scope for v0.
				</p>
			</div>

			<SectionHeading id="tables">Tables</SectionHeading>

			<div className="prose">
				<p>
					<strong>
						<code>bns_name_events</code>
					</strong>{" "}
					— one row per name-lifecycle event. <code>topic</code> discriminates:{" "}
					<code>new-name</code>, <code>transfer-name</code>,{" "}
					<code>renew-name</code>, <code>burn-name</code>,{" "}
					<code>new-airdrop</code>.
				</p>
				<p>
					<strong>
						<code>bns_namespace_events</code>
					</strong>{" "}
					— one row per namespace-lifecycle event. <code>status</code>{" "}
					discriminates: <code>launch</code>, <code>transfer-manager</code>,{" "}
					<code>freeze-manager</code>, <code>update-price-manager</code>,{" "}
					<code>freeze-price-manager</code>,{" "}
					<code>turn-off-manager-transfers</code>.
				</p>
				<p>
					<strong>
						<code>bns_marketplace_events</code>
					</strong>{" "}
					— one row per BNS-V2 NFT marketplace event. <code>list-in-ustx</code>{" "}
					/ <code>unlist-in-ustx</code> / <code>buy-in-ustx</code>.
				</p>
				<p>
					<strong>
						<code>bns_names</code>
					</strong>{" "}
					— current-state projection, one row per FQN. Maintained by the decoder
					via upsert; <code>burn-name</code> deletes.
				</p>
				<p>
					<strong>
						<code>bns_namespaces</code>
					</strong>{" "}
					— current-state projection per launched namespace.
				</p>
			</div>

			<SectionHeading id="api">API</SectionHeading>

			<div className="prose">
				<p>
					Six endpoints under <code>/v1/datasets/bns/*</code>:
				</p>
				<ul>
					<li>
						<code>GET /events</code> — filter by{" "}
						<code>topic, namespace, name, owner, from_block, to_block</code>.
						Cursor pagination.
					</li>
					<li>
						<code>GET /namespace-events</code> — filter by{" "}
						<code>status, namespace</code>.
					</li>
					<li>
						<code>GET /marketplace-events</code> — filter by{" "}
						<code>action, bns_id</code>.
					</li>
					<li>
						<code>GET /names</code> — current-state listing, filter by{" "}
						<code>namespace</code> or <code>owner</code>.
					</li>
					<li>
						<code>GET /namespaces</code> — current namespaces with managers and
						name counts.
					</li>
					<li>
						<code>GET /resolve?fqn=alice.btc</code> — single-row lookup.
					</li>
				</ul>
			</div>

			<DatasetSandbox
				endpoint="/v1/datasets/bns/events"
				title="Try bns/events"
				sample={{
					events: [
						{
							cursor: "7869999:12",
							block_height: 7869999,
							block_time: "2026-05-05T12:34:56.000Z",
							tx_id: "0xabc…",
							topic: "new-name",
							namespace: "btc",
							name: "alice",
							owner: "SP1…",
							bns_id: "12345",
						},
					],
					next_cursor: "7870001:3",
					tip: { block_height: 7889408 },
				}}
				filters={[
					{
						name: "topic",
						type: "enum",
						options: [
							"new-name",
							"transfer-name",
							"renew-name",
							"burn-name",
							"new-airdrop",
						],
						default: "new-name",
					},
					{ name: "limit", type: "number", default: "5", placeholder: "5" },
					{ name: "namespace", type: "string", placeholder: "btc" },
					{ name: "name", type: "string", placeholder: "alice" },
					{ name: "owner", type: "string", placeholder: "SP1..." },
				]}
			/>

			<DatasetSandbox
				endpoint="/v1/datasets/bns/resolve"
				title="Try bns/resolve"
				sample={{
					fqn: "alice.btc",
					namespace: "btc",
					name: "alice",
					owner: "SP1…",
					bns_id: "12345",
					registered_at: 7869999,
					renewal_height: 7919999,
					last_event_at: "2026-05-05T12:34:56.000Z",
				}}
				filters={[
					{
						name: "fqn",
						type: "string",
						default: "alice.btc",
						placeholder: "alice.btc",
					},
				]}
			/>

			<SectionHeading id="resolver">Resolver</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/datasets/bns/resolve?fqn=alice.btc</code> returns the
					current canonical owner row. 404 if not registered or burned.
				</p>
			</div>

			<SectionHeading id="parquet">Parquet</SectionHeading>

			<div className="prose">
				<p>
					Three parquet families mirror the API tables, partitioned by
					10,000-block range. Each family has its own manifest.
				</p>
			</div>

			<ParquetSnippet
				dataset="bns/name-events"
				title="bns/name-events"
				description="BNS-V2 name lifecycle events: register, transfer, renew, burn, airdrop."
			/>
			<ParquetSnippet
				dataset="bns/namespace-events"
				title="bns/namespace-events"
				description="BNS-V2 namespace lifecycle: preorder, reveal, ready, manager-update."
			/>
			<ParquetSnippet
				dataset="bns/marketplace-events"
				title="bns/marketplace-events"
				description="BNS-V2 marketplace activity: list, unlist, sale, price-change."
			/>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes{" "}
					<code>bns-name-events</code>, <code>bns-namespace-events</code>, and{" "}
					<code>bns-marketplace-events</code> entries with{" "}
					<code>latest_finalized_cursor</code>, <code>generated_at</code>, and{" "}
					<code>lag_blocks</code> against the chain tip.
				</p>
				<p>
					Schema doc: <code>docs/datasets/bns/schema.md</code>.
				</p>
			</div>
		</main>
	);
}
