"use client";

interface Finding {
	resource: string;
	resourceType: string;
	severity: "danger" | "warning" | "info";
	title: string;
	description: string;
	suggestion: string;
}

interface DeliverySummary {
	total: number;
	successful: number;
	failed: number;
	last: { statusCode: number | null; dispatchedAt: string } | null;
}

export function SubscriptionDiagnosticsCard({
	subscription,
	deliverySummary,
	findings,
}: {
	subscription: { name: string; status: string; target?: string };
	deliverySummary: DeliverySummary;
	findings: Finding[];
}) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">Subscription diagnostics</div>
			<div className="tool-status-row">
				<div className="tool-action-detail">
					<span className="tool-status-name">{subscription.name}</span>
					<span className="tool-action-reason">
						{subscription.target ?? subscription.status} ·{" "}
						{deliverySummary.successful}/{deliverySummary.total} recent attempts
						successful
					</span>
				</div>
			</div>
			{findings.map((finding) => (
				<div key={`${finding.title}-${finding.resource}`} className="diag-item">
					<div className={`diag-icon ${finding.severity}`}>
						<svg
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						>
							{finding.severity === "info" ? (
								<path d="M6 8l2 2 4-4" />
							) : (
								<>
									<path d="M8 5v3" />
									<circle cx="8" cy="10.5" r="0.5" fill="currentColor" />
								</>
							)}
						</svg>
					</div>
					<div className="diag-body">
						<div className="diag-title">{finding.title}</div>
						<div className="diag-desc">{finding.description}</div>
						{finding.suggestion && (
							<div className="diag-action">{finding.suggestion}</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
