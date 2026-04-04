"use client";

import { SubgraphCard } from "@/components/marketplace/subgraph-card";
import { SectionHeading } from "@/components/section-heading";
import { useMarketplaceCreator } from "@/lib/queries/marketplace";

function fmtK(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

export function CreatorDetail({ slug }: { slug: string }) {
	const { data, isLoading } = useMarketplaceCreator(slug);

	if (isLoading) {
		return <div className="mkt-empty">Loading...</div>;
	}

	if (!data) {
		return <div className="mkt-empty">Creator not found.</div>;
	}

	const totalQueries = data.subgraphs.reduce(
		(sum, s) => sum + s.totalQueries7d,
		0,
	);
	const initial = (data.displayName ?? slug)[0].toUpperCase();

	return (
		<>
			{/* Creator header */}
			<header className="mkt-creator-header">
				<div className="mkt-creator-avatar">{initial}</div>
				<div className="mkt-creator-info">
					<h1 className="mkt-creator-name">{data.displayName ?? slug}</h1>
					<div className="mkt-creator-slug">@{data.slug ?? slug}</div>
					{data.bio && <p className="mkt-creator-bio">{data.bio}</p>}
					<div className="mkt-creator-stats">
						<span>
							<strong>{data.subgraphs.length}</strong> public subgraph
							{data.subgraphs.length !== 1 ? "s" : ""}
						</span>
						<span>
							<strong>{fmtK(totalQueries)}</strong> queries / 7d
						</span>
					</div>
				</div>
			</header>

			{/* Subgraphs */}
			<SectionHeading id="subgraphs">Public subgraphs</SectionHeading>

			{data.subgraphs.length > 0 ? (
				<div className="mkt-card-list">
					{data.subgraphs.map((s) => (
						<SubgraphCard key={s.name} s={s} />
					))}
				</div>
			) : (
				<div className="mkt-empty">No public subgraphs yet.</div>
			)}
		</>
	);
}
