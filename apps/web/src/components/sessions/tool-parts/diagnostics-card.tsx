"use client";

interface Finding {
	resource: string;
	resourceType: string;
	severity: "danger" | "warning" | "info";
	title: string;
	description: string;
	suggestion: string;
}

interface DiagnosticsCardProps {
	findings: Finding[];
}

export function DiagnosticsCard({ findings }: DiagnosticsCardProps) {
	if (findings.length === 0) return null;

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
				Diagnostics
			</div>
			{findings.map((f) => (
				<div key={f.resource + f.title} className="diag-item">
					<div className={`diag-icon ${f.severity}`}>
						{f.severity === "info" ? (
							<svg
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<path d="M6 8l2 2 4-4" />
							</svg>
						) : (
							<svg
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<path d="M8 5v3" />
								<circle cx="8" cy="10.5" r="0.5" fill="currentColor" />
							</svg>
						)}
					</div>
					<div className="diag-body">
						<div className="diag-title">{f.title}</div>
						<div className="diag-desc">{f.description}</div>
						{f.suggestion && (
							<div className="diag-action">
								<svg
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									strokeLinecap="round"
								>
									<path d="M6 3l5 5-5 5" />
								</svg>
								{f.suggestion}
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
