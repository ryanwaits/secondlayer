"use client";

interface SubscriptionCreateInput {
	name: string;
	subgraphName: string;
	tableName: string;
	url: string;
	format?: string;
	runtime?: string | null;
	filter?: Record<string, unknown>;
	reason?: string;
}

interface SubscriptionCreateCardProps {
	input: SubscriptionCreateInput;
	onConfirm: () => void;
	onCancel: () => void;
}

export function SubscriptionCreateCard({
	input,
	onConfirm,
	onCancel,
}: SubscriptionCreateCardProps) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">Create subscription</div>
			<div className="tool-action-row">
				<div className="tool-action-detail">
					<span className="tool-status-name">{input.name}</span>
					<span className="tool-action-reason">
						{input.subgraphName}.{input.tableName} · {input.runtime ?? "none"} ·{" "}
						{input.format ?? "standard-webhooks"}
					</span>
					<span className="tool-action-reason">{input.url}</span>
					{input.reason && (
						<span className="tool-action-reason">{input.reason}</span>
					)}
					{input.filter && Object.keys(input.filter).length > 0 && (
						<span className="tool-action-reason">
							filter {JSON.stringify(input.filter)}
						</span>
					)}
				</div>
				<span className="tool-badge">HIL</span>
			</div>
			<div className="tool-card-footer">
				<button type="button" className="tool-btn ghost" onClick={onCancel}>
					Cancel
				</button>
				<button type="button" className="tool-btn primary" onClick={onConfirm}>
					Create
				</button>
			</div>
		</div>
	);
}
