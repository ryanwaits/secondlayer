"use client";

interface ActionTarget {
	id: string;
	name: string;
	reason?: string;
}

interface ActionCardProps {
	action: string;
	targets: ActionTarget[];
	onConfirm: () => void;
	onCancel: () => void;
}

const ACTION_LABELS: Record<string, string> = {
	pause: "Pause",
	resume: "Resume",
	delete: "Delete",
	"replay-failed": "Replay Failed",
};

export function ActionCard({
	action,
	targets,
	onConfirm,
	onCancel,
}: ActionCardProps) {
	const label = ACTION_LABELS[action] || action;
	const isDangerous = action === "delete";

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
				Streams to {label.toLowerCase()}
			</div>
			{targets.map((t) => (
				<div key={t.id} className="tool-action-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">{t.name}</span>
						{t.reason && (
							<span className="tool-action-reason">{t.reason}</span>
						)}
					</div>
					<span className="tool-badge error">{label}</span>
				</div>
			))}
			<div className="tool-card-footer">
				<button type="button" className="tool-btn ghost" onClick={onCancel}>
					Cancel
				</button>
				<button
					type="button"
					className={`tool-btn ${isDangerous ? "danger" : "primary"}`}
					onClick={onConfirm}
				>
					{label} All ({targets.length})
				</button>
			</div>
		</div>
	);
}
