import { OverviewTopbar } from "@/components/console/overview-topbar";
import Link from "next/link";
import { CATEGORIES, MARKETPLACE_SUBGRAPHS } from "./mock-data";

const TABLE_ICON = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
		<rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 7h12" />
	</svg>
);
const CHART_ICON = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
		<path d="M3 12l3-4 3 2 4-5" />
	</svg>
);

export default function MarketplacePage() {
	const grouped = new Map<string, typeof MARKETPLACE_SUBGRAPHS>();
	for (const sg of MARKETPLACE_SUBGRAPHS) {
		const list = grouped.get(sg.category) ?? [];
		list.push(sg);
		grouped.set(sg.category, list);
	}

	return (
		<>
			<OverviewTopbar page="Marketplace" showRefresh={false} />
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Search */}
					<div className="mp-search-wrap">
						<span className="mp-search-icon">
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
								<circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" />
							</svg>
						</span>
						<input className="mp-search" type="text" placeholder="Search subgraphs..." />
					</div>

					{/* Filters + sort */}
					<div className="mp-filter-row">
						<div className="mp-filter-tags">
							{CATEGORIES.map((cat) => (
								<button
									key={cat}
									type="button"
									className={`mp-filter-tag${cat === "All" ? " active" : ""}`}
								>
									{cat}
								</button>
							))}
						</div>
						<select className="mp-sort">
							<option>Most popular</option>
							<option>Recently added</option>
							<option>Most queries</option>
						</select>
					</div>

					{/* Groups */}
					{Array.from(grouped.entries()).map(([category, items]) => (
						<div key={category}>
							<div className="mp-section">
								<hr />
								<span className="mp-section-title">{category}</span>
							</div>
							<div className="mp-grid">
								{items.map((sg) => (
									<Link
										key={sg.slug}
										href={`/marketplace/${sg.slug}`}
										className="mp-card"
									>
										<div className="mp-card-header">
											<span className="mp-card-name">{sg.name}</span>
											<span className={`mp-card-status ${sg.status}`}>
												{sg.status}
											</span>
										</div>
										<div className="mp-card-desc">{sg.description}</div>
										<div className="mp-card-author">
											by @{sg.creatorHandle}
										</div>
										<div className="mp-card-tags">
											{sg.tags.map((t) => (
												<span key={t} className="mp-tag">{t}</span>
											))}
										</div>
										<div className="mp-card-stats">
											<span>{TABLE_ICON} {sg.tables} tables</span>
											<span>{CHART_ICON} {sg.queriesWeek} queries/7d</span>
										</div>
									</Link>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</>
	);
}
