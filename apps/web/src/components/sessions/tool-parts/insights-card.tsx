"use client";

interface InsightInfo {
	id: string;
	severity: "info" | "warning" | "danger";
	title: string;
	body: string;
	category: string;
}

interface InsightsCardProps {
	insights: InsightInfo[];
}

const SEVERITY_BADGE: Record<string, string> = {
	info: "tool-badge healthy",
	warning: "tool-badge syncing",
	danger: "tool-badge error",
};

export function InsightsCard({ insights }: InsightsCardProps) {
	if (insights.length === 0) return null;

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<circle cx="8" cy="8" r="6" />
					<path d="M8 5v3" />
					<circle cx="8" cy="11" r="0.5" fill="currentColor" />
				</svg>
				Insights
			</div>
			{insights.map((i) => (
				<div key={i.id} className="tool-action-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">{i.title}</span>
						<span className="tool-action-reason">{i.body}</span>
					</div>
					<span className={SEVERITY_BADGE[i.severity] ?? "tool-badge paused"}>
						{i.severity}
					</span>
				</div>
			))}
		</div>
	);
}
