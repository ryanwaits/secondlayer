"use client";

interface Delivery {
	id: string;
	attempt: number;
	statusCode: number | null;
	errorMessage: string | null;
	durationMs: number | null;
	dispatchedAt: string;
}

interface DeadRow {
	id: string;
	eventType: string;
	attempt: number;
	blockHeight: number;
	failedAt: string | null;
}

function status(value: number | null, error: string | null): string {
	if (value != null) return String(value);
	return error ?? "error";
}

export function SubscriptionDeliveryCard({
	deliveries,
	deadRows,
}: {
	deliveries: Delivery[];
	deadRows: DeadRow[];
}) {
	if (deliveries.length === 0 && deadRows.length === 0) return null;

	return (
		<div className="tool-card">
			<div className="tool-card-header">Delivery and DLQ</div>
			{deliveries.slice(0, 5).map((delivery) => (
				<div key={delivery.id} className="tool-status-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">
							attempt {delivery.attempt} ·{" "}
							{status(delivery.statusCode, delivery.errorMessage)}
						</span>
						<span className="tool-action-reason">
							{new Date(delivery.dispatchedAt).toLocaleString()} ·{" "}
							{delivery.durationMs != null
								? `${delivery.durationMs}ms`
								: "no duration"}
						</span>
					</div>
				</div>
			))}
			{deadRows.slice(0, 5).map((row) => (
				<div key={row.id} className="tool-action-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">{row.eventType}</span>
						<span className="tool-action-reason">
							outbox {row.id} · block {row.blockHeight} · attempt {row.attempt}
						</span>
						<span className="tool-action-reason">
							failed{" "}
							{row.failedAt
								? new Date(row.failedAt).toLocaleString()
								: "unknown"}
						</span>
					</div>
					<span className="tool-badge error">dead</span>
				</div>
			))}
		</div>
	);
}
