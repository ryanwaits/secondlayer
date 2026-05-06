import { SectionHeading } from "@/components/section-heading";
import { Sidebar } from "@/components/sidebar";
import type { TocItem } from "@/components/sidebar";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Stacks Datasets | secondlayer",
	description:
		"Curated, public-good Stacks datasets with stable APIs, parquet downloads, and dashboard views.",
};

const toc: TocItem[] = [
	{ label: "Overview", href: "#overview" },
	{ label: "The shelf", href: "#the-shelf" },
	{ label: "How to read", href: "#how-to-read" },
	{ label: "Pricing", href: "#pricing" },
];

export type DatasetEntry = {
	slug: string;
	name: string;
	status: "shipped" | "planned";
	summary: string;
	apiPath: string | null;
	parquetPrefix: string | null;
	href: string | null;
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
		status: "planned",
		summary:
			"Cycles, delegations, and signer metrics decoded from PoX-4 contract events.",
		apiPath: null,
		parquetPrefix: null,
		href: null,
	},
	{
		slug: "sbtc",
		name: "sBTC",
		status: "planned",
		summary:
			"Mints, burns, transfers, and supply snapshots for the sBTC asset.",
		apiPath: null,
		parquetPrefix: null,
		href: null,
	},
	{
		slug: "bns",
		name: "BNS",
		status: "planned",
		summary:
			"Names, namespaces, ownership history, and renewals from the BNS contracts.",
		apiPath: null,
		parquetPrefix: null,
		href: null,
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

			<SectionHeading id="overview">Overview</SectionHeading>

			<div className="prose">
				<p>
					Stacks Datasets are curated, public-good data products. Each dataset
					ships with a stable read API, a parquet download path, a schema
					reference, a dashboard view, and a freshness signal.
				</p>
				<p>
					Datasets share the same publishing harness as Streams bulk dumps —
					parquet files partitioned by Stacks block height, refreshed on a
					schedule, with a machine-readable manifest at{" "}
					<code>manifest/latest.json</code>.
				</p>
			</div>

			<SectionHeading id="the-shelf">The shelf</SectionHeading>

			<DatasetsList />

			<SectionHeading id="how-to-read">How to read</SectionHeading>

			<div className="prose">
				<p>Two access modes per dataset:</p>
				<ul>
					<li>
						<strong>Read API.</strong> JSON over HTTPS with cursor pagination.
						Best for dashboards, app event loops, and ad-hoc queries.
					</li>
					<li>
						<strong>Parquet download.</strong> Bulk historical files for
						warehouses, DuckDB, Spark, pandas. Best for ETL and analytics.
					</li>
				</ul>
				<p>
					Read the manifest first; it points at every published file with row
					counts and SHA-256 checksums.
				</p>
			</div>

			<SectionHeading id="pricing">Pricing</SectionHeading>

			<div className="prose">
				<p>
					Dataset reads are free for low-volume use. Heavy programmatic use
					rolls into Build or Scale via the standard API key path. Parquet
					downloads remain free regardless of tier.
				</p>
			</div>
		</main>
	);
}

export function DatasetsList() {
	return (
		<div className="prose">
			<table>
				<thead>
					<tr>
						<th>Dataset</th>
						<th>Status</th>
						<th>API</th>
						<th>Parquet</th>
					</tr>
				</thead>
				<tbody>
					{datasets.map((dataset) => (
						<tr key={dataset.slug}>
							<td>
								{dataset.href ? (
									<a href={dataset.href}>{dataset.name}</a>
								) : (
									dataset.name
								)}
								<div style={{ opacity: 0.7 }}>{dataset.summary}</div>
							</td>
							<td>{dataset.status === "shipped" ? "Shipped" : "Planned"}</td>
							<td>
								{dataset.apiPath ? <code>{dataset.apiPath}</code> : "—"}
							</td>
							<td>
								{dataset.parquetPrefix ? (
									<code>{dataset.parquetPrefix}</code>
								) : (
									"—"
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
