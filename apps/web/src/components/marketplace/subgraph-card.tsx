"use client";

import type { MarketplaceSubgraphSummary } from "@/lib/marketplace-types";
import Link from "next/link";
import { useRouter } from "next/navigation";

function formatQueries(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

export function SubgraphCard({ s }: { s: MarketplaceSubgraphSummary }) {
	const router = useRouter();

	return (
		<div
			className="mkt-card"
			onClick={() => router.push(`/marketplace/${s.name}`)}
			onKeyDown={(e) => {
				if (e.key === "Enter") router.push(`/marketplace/${s.name}`);
			}}
		>
			<div className="mkt-card-header">
				<span className="mkt-card-name">{s.name}</span>
				<span className="mkt-badge" data-status={s.status}>
					{s.status}
				</span>
			</div>

			{s.description && <div className="mkt-card-desc">{s.description}</div>}

			{s.creator.slug && (
				<div className="mkt-card-creator">
					by{" "}
					<Link
						href={`/marketplace/creators/${s.creator.slug}`}
						onClick={(e) => e.stopPropagation()}
					>
						@{s.creator.slug}
					</Link>
				</div>
			)}

			{s.tags.length > 0 && (
				<div className="mkt-card-tags">
					{s.tags.map((t) => (
						<span key={t} className="mkt-card-tag">
							{t}
						</span>
					))}
				</div>
			)}

			<div className="mkt-card-stats">
				<span className="mkt-card-stat">
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<rect x="2" y="3" width="12" height="11" rx="1" />
						<path d="M5 3V1m6 2V1m-9 5h12" />
					</svg>
					{s.tables.length} {s.tables.length === 1 ? "table" : "tables"}
				</span>
				<span className="mkt-card-stat">
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<path d="M2 12l3-4 3 2 4-6" />
					</svg>
					{formatQueries(s.totalQueries7d)} queries/7d
				</span>
			</div>
		</div>
	);
}
