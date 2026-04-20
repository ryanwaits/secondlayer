import { DetailSection } from "@/components/console/detail-section";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MARKETPLACE_SUBGRAPHS } from "../../mock-data";

const TABLE_ICON = (
	<svg
		width="11"
		height="11"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<rect x="2" y="3" width="12" height="10" rx="1.5" />
		<path d="M2 7h12" />
	</svg>
);
const CHART_ICON = (
	<svg
		width="11"
		height="11"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<path d="M3 12l3-4 3 2 4-5" />
	</svg>
);

const CREATORS: Record<string, { name: string; bio: string }> = {
	jamesbuilds: {
		name: "James",
		bio: "Building DeFi indexing tools for the Stacks ecosystem.",
	},
	stacksdev: {
		name: "StacksDev",
		bio: "Core contributor to sBTC indexing and DeFi analytics infrastructure.",
	},
	alexlab: {
		name: "Alex Lab",
		bio: "Building the leading DEX on Stacks with open-source analytics.",
	},
	stackingdao: {
		name: "StackingDAO",
		bio: "Liquid stacking protocol on Stacks — making stacking accessible.",
	},
	ryanwaits: {
		name: "Ryan Waits",
		bio: "Building Secondlayer — infrastructure for Stacks developers.",
	},
};

export default async function CreatorProfilePage({
	params,
}: {
	params: Promise<{ handle: string }>;
}) {
	const { handle } = await params;
	const creator = CREATORS[handle];
	if (!creator) notFound();

	const subgraphs = MARKETPLACE_SUBGRAPHS.filter(
		(sg) => sg.creatorHandle === handle,
	);
	const totalQueries = subgraphs.reduce((s, sg) => {
		const num = Number.parseFloat(sg.queriesWeek.replace("k", "")) * 1000;
		return s + num;
	}, 0);

	return (
		<>
			<OverviewTopbar
				path={
					<Link
						href="/marketplace"
						style={{ color: "inherit", textDecoration: "none" }}
					>
						Marketplace
					</Link>
				}
				page={`@${handle}`}
				showRefresh={false}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					{/* Creator header */}
					<div className="mp-creator-header">
						<div className="mp-creator-avatar">{creator.name[0]}</div>
						<div className="mp-creator-info">
							<h1 className="mp-creator-name">{creator.name}</h1>
							<div className="mp-creator-slug">@{handle}</div>
							<p className="mp-creator-bio">{creator.bio}</p>
							<div className="mp-creator-stats">
								<span>
									<strong>{subgraphs.length}</strong> public subgraphs
								</span>
								<span>
									<strong>{(totalQueries / 1000).toFixed(1)}k</strong> queries /
									7d
								</span>
							</div>
						</div>
					</div>

					{/* Subgraphs */}
					<DetailSection title="Public Subgraphs">
						<div className="mp-grid">
							{subgraphs.map((sg) => (
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
									<div className="mp-card-tags">
										{sg.tags.map((t) => (
											<span key={t} className="mp-tag">
												{t}
											</span>
										))}
									</div>
									<div className="mp-card-stats">
										<span>
											{TABLE_ICON} {sg.tables} tables
										</span>
										<span>
											{CHART_ICON} {sg.queriesWeek} queries/7d
										</span>
									</div>
								</Link>
							))}
						</div>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
