"use client";

import { TabbedCode } from "@/components/console/tabbed-code";
import { SectionHeading } from "@/components/section-heading";
import { useMarketplaceDetail } from "@/lib/queries/marketplace";
import Link from "next/link";

function fmt(n: number): string {
	return n.toLocaleString("en-US");
}

function fmtK(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

export function SubgraphDetail({ name }: { name: string }) {
	const { data, isLoading } = useMarketplaceDetail(name);

	if (isLoading) {
		return <div className="mkt-empty">Loading...</div>;
	}

	if (!data) {
		return <div className="mkt-empty">Subgraph not found.</div>;
	}

	const tables = Object.entries(data.tableSchemas ?? {});
	const maxCount = Math.max(
		...(data.usage?.daily ?? []).map((d) => d.count).filter(Boolean),
		1,
	);

	// Chart label dates — show 5 evenly spaced
	const daily = data.usage?.daily ?? [];
	const labelIdxs =
		daily.length >= 5
			? [
					0,
					Math.floor(daily.length / 4),
					Math.floor(daily.length / 2),
					Math.floor((3 * daily.length) / 4),
					daily.length - 1,
				]
			: daily.map((_, i) => i);

	return (
		<>
			{/* Header */}
			<header className="mkt-sg-header">
				<div className="mkt-sg-title-row">
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<h1 className="mkt-sg-name">{data.name}</h1>
						<span className="mkt-badge" data-status={data.status}>
							{data.status}
						</span>
					</div>
					<div className="mkt-sg-actions">
						<button type="button" className="mkt-btn mkt-btn-secondary">
							<svg
								aria-hidden="true"
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							>
								<rect x="2" y="2" width="8" height="8" rx="1.5" />
								<path d="M6 10.5V12a1.5 1.5 0 001.5 1.5H12A1.5 1.5 0 0013.5 12V7.5A1.5 1.5 0 0012 6h-1.5" />
							</svg>
							Copy
						</button>
						<button type="button" className="mkt-btn mkt-btn-primary">
							<svg
								aria-hidden="true"
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							>
								<circle cx="5" cy="3.5" r="1.5" />
								<circle cx="5" cy="12.5" r="1.5" />
								<circle cx="11" cy="3.5" r="1.5" />
								<path d="M5 5v6M11 5c0 3-6 3-6 6" />
							</svg>
							Fork
							{(data.forkCount ?? 0) > 0 && (
								<span className="mkt-btn-count">{data.forkCount}</span>
							)}
						</button>
					</div>
				</div>
				{data.description && <p className="mkt-sg-desc">{data.description}</p>}
				{data.creator?.slug && (
					<div className="mkt-sg-creator">
						by{" "}
						<Link href={`/marketplace/creators/${data.creator.slug}`}>
							@{data.creator.slug}
						</Link>
					</div>
				)}
				{data.tags.length > 0 && (
					<div className="mkt-sg-tags">
						{data.tags.map((t) => (
							<span key={t} className="mkt-sg-tag">
								{t}
							</span>
						))}
					</div>
				)}
			</header>

			{/* Stats */}
			<div className="mkt-stats-row" id="stats">
				<div className="mkt-stat-card">
					<div className="mkt-stat-label">Queries (7d)</div>
					<div className="mkt-stat-value">
						{fmt(data.usage?.totalQueries7d ?? 0)}
					</div>
				</div>
				<div className="mkt-stat-card">
					<div className="mkt-stat-label">Queries (30d)</div>
					<div className="mkt-stat-value">
						{fmt(data.usage?.totalQueries30d ?? 0)}
					</div>
				</div>
				<div className="mkt-stat-card">
					<div className="mkt-stat-label">Tables</div>
					<div className="mkt-stat-value">{tables.length}</div>
				</div>
				<div className="mkt-stat-card">
					<div className="mkt-stat-label">Forks</div>
					<div className="mkt-stat-value">{data.forkCount ?? 0}</div>
				</div>
				<div className="mkt-stat-card">
					<div className="mkt-stat-label">Version</div>
					<div className="mkt-stat-value">v{data.version}</div>
				</div>
			</div>

			{/* Query volume chart */}
			<SectionHeading id="query-volume">Query volume</SectionHeading>

			{daily.length > 0 && (
				<div className="mkt-chart-wrap">
					<div className="mkt-chart-header">
						<span className="mkt-chart-title">Daily queries</span>
						<span className="mkt-chart-range">Last 30 days</span>
					</div>
					<div className="mkt-chart-bars">
						{daily.map((d) => (
							<div
								key={d.date}
								className="mkt-chart-bar"
								style={{
									height: `${Math.max(2, (d.count / maxCount) * 100)}%`,
								}}
								title={`${d.date}: ${fmt(d.count)}`}
							/>
						))}
					</div>
					<div className="mkt-chart-labels">
						{labelIdxs.map((i) => (
							<span key={daily[i]?.date}>{daily[i]?.date.slice(5)}</span>
						))}
					</div>
				</div>
			)}

			{/* Table schemas */}
			<SectionHeading id="tables">Tables &amp; Endpoints</SectionHeading>

			<div className="mkt-table-list">
				{tables.map(([tableName, schema]) => {
					const cols = Object.entries(schema.columns ?? {});
					return (
						<div key={tableName} className="mkt-table-card">
							<div className="mkt-table-header">
								<span className="mkt-table-name">{tableName}</span>
								<div className="mkt-table-meta">
									<span>{fmt(schema.rowCount)} rows</span>
									<span>{cols.length} columns</span>
								</div>
							</div>
							<div className="mkt-table-columns">
								{cols.map(([colName, col]) => (
									<div key={colName} className="mkt-table-col">
										<span className="mkt-col-name">{colName}</span>
										<span className="mkt-col-type">{col.type}</span>
									</div>
								))}
							</div>
						</div>
					);
				})}
			</div>

			{/* Quick start */}
			<SectionHeading id="quick-start">Quick start</SectionHeading>

			{tables.length > 0 && (
				<TabbedCode
					tabs={tables.map(([tableName, schema]) => ({
						label: tableName,
						lang: "bash",
						code: `curl "https://api.secondlayer.xyz${schema.endpoint}?limit=10"`,
					}))}
				/>
			)}

			{/* Metadata */}
			<SectionHeading id="details">Details</SectionHeading>

			<div className="mkt-meta-grid">
				<div className="mkt-meta-item">
					<span className="mkt-meta-label">Start Block</span>
					<span className="mkt-meta-value">{fmt(data.startBlock ?? 0)}</span>
				</div>
				<div className="mkt-meta-item">
					<span className="mkt-meta-label">Last Processed Block</span>
					<span className="mkt-meta-value">
						{fmt(data.lastProcessedBlock ?? 0)}
					</span>
				</div>
				<div className="mkt-meta-item">
					<span className="mkt-meta-label">Created</span>
					<span className="mkt-meta-value">
						{data.createdAt?.slice(0, 10) ?? "—"}
					</span>
				</div>
				{data.forkedFrom && (
					<div className="mkt-meta-item">
						<span className="mkt-meta-label">Forked From</span>
						<span className="mkt-meta-value">
							<Link
								href={`/marketplace/${data.forkedFrom.name}`}
								style={{ color: "var(--accent)" }}
							>
								{data.forkedFrom.name}
							</Link>
						</span>
					</div>
				)}
			</div>
		</>
	);
}
