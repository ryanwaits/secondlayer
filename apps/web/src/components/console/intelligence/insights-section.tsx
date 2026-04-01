"use client";

import { useInsights } from "@/lib/queries/insights";
import { InsightCard } from "./insight-card";

export function InsightsSection({
	category,
	resourceId,
	sessionToken,
	title,
}: {
	category?: string;
	resourceId?: string;
	sessionToken: string;
	title?: string;
}) {
	const { data: insights = [] } = useInsights({ category, resourceId });

	if (insights.length === 0) return null;

	return (
		<>
			{title && (
				<div className="dash-section-wrap">
					<hr />
					<h2 className="dash-section-title">{title}</h2>
				</div>
			)}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 8,
					marginBottom: 16,
				}}
			>
				{insights.map((insight) => (
					<InsightCard
						key={insight.id}
						insight={insight}
						sessionToken={sessionToken}
					/>
				))}
			</div>
		</>
	);
}
