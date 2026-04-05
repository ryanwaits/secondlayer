import { DetailSection } from "@/components/console/detail-section";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MARKETPLACE_SUBGRAPHS } from "../mock-data";

const CHART_HEIGHTS = [35,42,38,50,45,55,60,48,52,58,42,65,70,62,55,48,72,78,68,80,75,82,88,85,90,78,92,95,88,100];

export default async function MarketplaceDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const sg = MARKETPLACE_SUBGRAPHS.find((s) => s.slug === slug);
	if (!sg) notFound();

	return (
		<>
			<OverviewTopbar
				path={
					<>
						<Link href="/marketplace" style={{ color: "inherit", textDecoration: "none" }}>Marketplace</Link>
						{" / "}
						<Link href={`/marketplace/creator/${sg.creatorHandle}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
							@{sg.creatorHandle}
						</Link>
					</>
				}
				page={sg.name}
				showRefresh={false}
				showTimeRange={false}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Header */}
					<div className="mp-sg-header">
						<div className="mp-sg-header-left">
							<div className="mp-sg-name">
								{sg.name} <span className={`badge ${sg.status}`}>{sg.status}</span>
							</div>
							<p className="mp-sg-desc">{sg.description}</p>
							<div className="mp-sg-creator">
								by <Link href={`/marketplace/creator/${sg.creatorHandle}`}>@{sg.creatorHandle}</Link>
							</div>
							<div className="mp-sg-tags">
								{sg.tags.map((t) => <span key={t} className="mp-tag">{t}</span>)}
							</div>
						</div>
						<div className="mp-sg-actions">
							<button type="button" className="mp-btn mp-btn-secondary">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
									<path d="M5 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-2" />
									<path d="M7 9l7-7M10 2h4v4" />
								</svg>
								Copy Config
							</button>
							<button type="button" className="mp-btn mp-btn-primary">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
									<path d="M5 2v3a1 1 0 01-1 1H2m12-2v10a1 1 0 01-1 1H3a1 1 0 01-1-1V5l4-4h7a1 1 0 011 1z" />
								</svg>
								Fork
								<span className="fork-count">12</span>
							</button>
						</div>
					</div>

					{/* Stats */}
					<div className="mp-stats-row">
						<div className="sg-meta-card">
							<div className="sg-meta-label">Queries (7d)</div>
							<div className="sg-meta-value" style={{ fontSize: 20, fontFamily: "var(--font-mono-stack)" }}>12,438</div>
							<div style={{ fontSize: 11, color: "var(--green)", marginTop: 2 }}>+18% vs prev week</div>
						</div>
						<div className="sg-meta-card">
							<div className="sg-meta-label">Queries (30d)</div>
							<div className="sg-meta-value" style={{ fontSize: 20, fontFamily: "var(--font-mono-stack)" }}>41,207</div>
						</div>
						<div className="sg-meta-card">
							<div className="sg-meta-label">Tables</div>
							<div className="sg-meta-value" style={{ fontSize: 20, fontFamily: "var(--font-mono-stack)" }}>{sg.tables}</div>
						</div>
						<div className="sg-meta-card">
							<div className="sg-meta-label">Forks</div>
							<div className="sg-meta-value" style={{ fontSize: 20, fontFamily: "var(--font-mono-stack)" }}>12</div>
						</div>
						<div className="sg-meta-card">
							<div className="sg-meta-label">Version</div>
							<div className="sg-meta-value" style={{ fontSize: 20, fontFamily: "var(--font-mono-stack)" }}>v4</div>
							<div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Deployed 2d ago</div>
						</div>
					</div>

					{/* Chart */}
					<DetailSection title="Query Volume">
						<div className="mp-chart-wrap">
							<div className="mp-chart-header">
								<span className="mp-chart-title">Daily queries</span>
								<span className="mp-chart-range">Last 30 days</span>
							</div>
							<div className="mp-chart-bars">
								{CHART_HEIGHTS.map((h, i) => (
									<div key={i} className="mp-chart-bar" style={{ height: `${h}%` }} />
								))}
							</div>
							<div className="mp-chart-labels">
								<span>Mar 5</span><span>Mar 12</span><span>Mar 19</span><span>Mar 26</span><span>Apr 3</span>
							</div>
						</div>
					</DetailSection>

					{/* Tables */}
					<DetailSection title="Tables &amp; Endpoints">
						<div className="mp-table-list">
							<div className="mp-table-card">
								<div className="mp-table-header">
									<span className="mp-table-name">swaps</span>
									<div className="mp-table-meta"><span>482,319 rows</span><span>6 columns</span></div>
								</div>
								<div className="mp-table-columns">
									<div className="mp-table-col"><span className="mp-col-name">tx_id</span> <span className="mp-col-type">text</span></div>
									<div className="mp-table-col"><span className="mp-col-name">block_height</span> <span className="mp-col-type">integer</span></div>
									<div className="mp-table-col"><span className="mp-col-name">sender</span> <span className="mp-col-type">text</span></div>
									<div className="mp-table-col"><span className="mp-col-name">token_in</span> <span className="mp-col-type">text</span></div>
								</div>
								<div className="mp-table-endpoint">
									Endpoint <span className="mp-endpoint-url">/api/marketplace/subgraphs/{sg.slug}/swaps</span>
								</div>
							</div>
						</div>
					</DetailSection>

					{/* Metadata */}
					<DetailSection title="Details">
						<div className="mp-meta-grid">
							<div className="mp-meta-item"><span className="mp-meta-label">Start Block</span><span className="mp-meta-value">100,000</span></div>
							<div className="mp-meta-item"><span className="mp-meta-label">Last Processed Block</span><span className="mp-meta-value">7,482,103</span></div>
							<div className="mp-meta-item"><span className="mp-meta-label">Created</span><span className="mp-meta-value">2025-11-14</span></div>
							<div className="mp-meta-item"><span className="mp-meta-label">Last Updated</span><span className="mp-meta-value">2026-04-01</span></div>
						</div>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
