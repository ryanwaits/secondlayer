import { Callout } from "@/components/callout";
import { CodeBlock } from "@/components/code-block";
import { DatasetsDiagram } from "@/components/diagrams/datasets-diagram";
import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Stacks Datasets | secondlayer",
	description:
		"Curated, ready-to-query Stacks datasets — sBTC, stacking, BNS and more. Stable APIs + parquet, free to read.",
};

const toc: TocItem[] = [
	{ label: "How it works", href: "#how-it-works" },
	{ label: "The shelf", href: "#the-shelf" },
	{ label: "How to read", href: "#how-to-read" },
];

export type DatasetEntry = {
	slug: string;
	name: string;
	status: "shipped" | "coming-soon" | "planned";
	summary: string;
	apiPath: string | null;
	parquetPrefix: string | null;
	href: string | null;
};

const STATUS_LABELS: Record<DatasetEntry["status"], string> = {
	shipped: "Shipped",
	"coming-soon": "Coming soon",
	planned: "Planned",
};

export const datasets: DatasetEntry[] = [
	{
		slug: "stx-transfers",
		name: "STX Transfers",
		status: "shipped",
		summary:
			"Every canonical STX transfer event with sender, recipient, amount, and memo.",
		apiPath: "/v1/datasets/stx-transfers",
		parquetPrefix: "stacks-datasets/mainnet/v0/stx-transfers",
		href: "/datasets/stx-transfers",
	},
	{
		slug: "pox-4",
		name: "PoX-4 / Stacking",
		status: "shipped",
		summary:
			"Solo, delegated, aggregated stacking calls — every PoX-4 contract call decoded with cycle math, BTC payout addresses, and signer keys.",
		apiPath: "/v1/datasets/pox-4/calls",
		parquetPrefix: null,
		href: "/datasets/pox-4",
	},
	{
		slug: "sbtc",
		name: "sBTC",
		status: "shipped",
		summary:
			"Deposits, withdrawals (create/accept/reject), signer-set rotations, governance hooks, plus SIP-010 mint/burn/transfer on sbtc-token.",
		apiPath: "/v1/datasets/sbtc/events",
		parquetPrefix: "stacks-datasets/mainnet/v0/sbtc",
		href: "/datasets/sbtc",
	},
	{
		slug: "bns",
		name: "BNS",
		status: "shipped",
		summary:
			"BNS-V2 names, namespaces, marketplace listings, plus a current-state projection for fast resolve(fqn).",
		apiPath: "/v1/datasets/bns/name-events",
		parquetPrefix: null,
		href: "/datasets/bns",
	},
	{
		slug: "network-health",
		name: "Network Health",
		status: "shipped",
		summary:
			"Daily rollup of canonical block count, average block time, and reorg count.",
		apiPath: "/v1/datasets/network-health/summary",
		parquetPrefix: null,
		href: "/datasets/network-health",
	},
];

export default function DatasetsPage() {
	return (
		<div className="article-layout">
			<Sidebar title="Stacks Datasets" toc={toc} />
			<DatasetsContent />
		</div>
	);
}

export function DatasetsContent() {
	return (
		<main className="content-area">
			<header className="page-header">
				<h1 className="page-title">Stacks Datasets</h1>
			</header>

			<div className="prose">
				<p>
					Datasets are curated, ready-to-query views of Stacks data — sBTC,
					stacking, BNS and more. Each ships a stable read API, a parquet
					download, a schema reference, and a freshness signal. Free to read and
					always on — you never run a node.
				</p>
				<p>
					They share the same publishing harness as{" "}
					<Link href="/streams">Streams</Link> bulk dumps: parquet partitioned
					by Stacks block height, refreshed on a schedule, with a
					machine-readable manifest at <code>manifest/latest.json</code>.
				</p>
			</div>

			<SectionHeading id="how-it-works">How it works</SectionHeading>

			<DatasetsDiagram />

			<div className="prose">
				<p>
					Each dataset is a curated view over the raw L1 events — decoded and
					shaped for one domain, then served two ways: a cursor-paginated JSON
					API for apps and dashboards, and bulk parquet for warehouses and
					notebooks.
				</p>
			</div>

			<SectionHeading id="the-shelf">The shelf</SectionHeading>

			<DatasetsList />

			<SectionHeading id="how-to-read">How to read</SectionHeading>

			<div className="prose">
				<p>
					Reads are open — no key needed for low-volume use. Hit the JSON API
					for live queries, or pull parquet for analytics:
				</p>
			</div>

			<CodeBlock
				code={`# JSON API — cursor-paginated, anonymous
curl "https://api.secondlayer.tools/v1/datasets/sbtc/events?limit=5"

# Bulk parquet — read straight into DuckDB
SELECT * FROM 'https://data.secondlayer.tools/stacks-datasets/mainnet/v0/sbtc/*.parquet'
LIMIT 5;`}
				lang="bash"
			/>

			<div className="prose">
				<p>
					Read the manifest first — it points at every published file with row
					counts and SHA-256 checksums.
				</p>
			</div>

			<Callout label="Full reference">
				<p>
					Per-dataset schemas, endpoints, and parquet paths live in the docs →{" "}
					<Link href="/docs/datasets">/docs/datasets</Link>.
				</p>
			</Callout>
		</main>
	);
}

export function DatasetsList() {
	return (
		<ul className="dataset-shelf">
			{datasets.map((dataset) => (
				<li key={dataset.slug} className="dataset-shelf-row">
					<div className="dataset-shelf-head">
						{dataset.href ? (
							<Link href={dataset.href} className="dataset-shelf-name">
								{dataset.name}
							</Link>
						) : (
							<span className="dataset-shelf-name">{dataset.name}</span>
						)}
						<span className="dataset-shelf-status">
							{STATUS_LABELS[dataset.status]}
						</span>
					</div>
					<p className="dataset-shelf-summary">{dataset.summary}</p>
					<div className="dataset-shelf-meta">
						{dataset.apiPath ? (
							<span className="dataset-endpoint">
								<span className="dataset-endpoint-label">API</span>
								<code>{dataset.apiPath}</code>
							</span>
						) : null}
						{dataset.parquetPrefix ? (
							<span className="dataset-endpoint">
								<span className="dataset-endpoint-label">Parquet</span>
								<code>{dataset.parquetPrefix}</code>
							</span>
						) : null}
					</div>
				</li>
			))}
		</ul>
	);
}
