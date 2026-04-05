"use client";

interface StreamStatus {
	id: string;
	name: string;
	status: string;
	enabled: boolean;
	totalDeliveries: number;
	failedDeliveries: number;
	errorMessage: string | null;
}

interface StreamStatusCardProps {
	streams: StreamStatus[];
}

function statusBadgeClass(status: string, enabled: boolean): string {
	if (!enabled) return "tool-badge paused";
	switch (status) {
		case "active":
			return "tool-badge healthy";
		case "paused":
			return "tool-badge paused";
		case "failed":
			return "tool-badge error";
		default:
			return "tool-badge paused";
	}
}

function statusLabel(status: string, enabled: boolean): string {
	if (!enabled) return "Disabled";
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export function StreamStatusCard({ streams }: StreamStatusCardProps) {
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
					<circle cx="8" cy="8" r="2" />
					<path d="M2 8h4M10 8h4" />
				</svg>
				Streams
			</div>
			{streams.map((s) => (
				<div key={s.id} className="tool-status-row">
					<span className="tool-status-name">{s.name}</span>
					<span className={statusBadgeClass(s.status, s.enabled)}>
						{statusLabel(s.status, s.enabled)}
					</span>
					<span className="tool-status-meta">
						{s.totalDeliveries > 0
							? `${s.failedDeliveries}/${s.totalDeliveries} failed`
							: "no deliveries"}
					</span>
				</div>
			))}
		</div>
	);
}
