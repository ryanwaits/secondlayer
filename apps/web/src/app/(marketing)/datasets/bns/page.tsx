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

function InlineCodeBlock({ children }: { children: string }) {
	return (
		<pre className="code-block">
			<code>{children.trim()}</code>
		</pre>
	);
}

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
					v0 ships BNS-V2 only. BNS-V1 historical names are out of scope.
					Subdomain registrations and zonefile resolution are also out of scope
					for v0.
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
						<code>GET /name-events</code> — filter by{" "}
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

			<InlineCodeBlock>
				{`curl "https://api.secondlayer.tools/v1/datasets/bns/name-events?topic=new-name&limit=5"`}
			</InlineCodeBlock>

			<SectionHeading id="resolver">Resolver</SectionHeading>

			<div className="prose">
				<p>
					<code>GET /v1/datasets/bns/resolve?fqn=alice.btc</code> returns the
					current canonical owner row. 404 if not registered or burned.
				</p>
			</div>

			<InlineCodeBlock>
				{`{
  "fqn": "alice.btc",
  "namespace": "btc",
  "name": "alice",
  "owner": "SP1...",
  "bns_id": "12345",
  "registered_at": 7869999,
  "renewal_height": 7919999,
  "last_event_at": "2026-05-05T12:34:56.000Z"
}`}
			</InlineCodeBlock>

			<SectionHeading id="freshness">Freshness</SectionHeading>

			<div className="prose">
				<p>
					<code>/public/status.datasets[]</code> includes a{" "}
					<code>bns-name-events</code> entry with{" "}
					<code>latest_finalized_cursor</code>, <code>generated_at</code>, and{" "}
					<code>lag_blocks</code> against the chain tip. Parquet exporter is
					deferred — the API is the primary surface for v0.
				</p>
				<p>
					Schema doc: <code>docs/datasets/bns/schema.md</code>.
				</p>
			</div>
		</main>
	);
}
