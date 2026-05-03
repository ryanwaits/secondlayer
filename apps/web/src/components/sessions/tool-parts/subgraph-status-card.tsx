"use client";

interface SubgraphStatus {
	name: string;
	status: string;
	lastProcessedBlock: number | null;
	totalRows?: number;
	totalErrors: number;
	tables?: string[];
	resourceWarning?: {
		code: string;
		message: string;
		blockRange: number;
		processorMemoryMb: number;
		recommendedPlan: "launch";
	};
}

interface SubgraphStatusCardProps {
	subgraphs: SubgraphStatus[];
}

function statusBadgeClass(status: string): string {
	switch (status) {
		case "active":
		case "healthy":
			return "tool-badge healthy";
		case "syncing":
		case "catchup":
			return "tool-badge syncing";
		case "error":
		case "failed":
			return "tool-badge error";
		case "paused":
			return "tool-badge paused";
		default:
			return "tool-badge paused";
	}
}

function statusLabel(status: string): string {
	switch (status) {
		case "active":
			return "Healthy";
		case "catchup":
			return "Syncing";
		default:
			return status.charAt(0).toUpperCase() + status.slice(1);
	}
}

export function SubgraphStatusCard({ subgraphs }: SubgraphStatusCardProps) {
	if (subgraphs.length === 0) return null;

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<path d="M9 2L5 14M3 5l-2 3 2 3M13 5l2 3-2 3" />
				</svg>
				Subgraphs
			</div>
			{subgraphs.map((s) => (
				<div key={s.name}>
					<div className="tool-status-row">
						<span className="tool-status-name">{s.name}</span>
						<span className={statusBadgeClass(s.status)}>
							{statusLabel(s.status)}
						</span>
						<span className="tool-status-meta">
							{s.lastProcessedBlock != null
								? `block ${s.lastProcessedBlock.toLocaleString()}`
								: "—"}
							{s.totalRows != null && ` · ${formatCount(s.totalRows)} rows`}
						</span>
					</div>
					{s.resourceWarning && (
						<div className="tool-error-body">
							{s.resourceWarning.message} Current processor limit:{" "}
							{s.resourceWarning.processorMemoryMb} MB; range:{" "}
							{s.resourceWarning.blockRange.toLocaleString()} blocks.
						</div>
					)}
				</div>
			))}
		</div>
	);
}

function formatCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
	return String(n);
}
