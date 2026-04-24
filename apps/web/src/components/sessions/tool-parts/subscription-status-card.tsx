"use client";

interface SubscriptionStatus {
	id: string;
	name: string;
	status: string;
	target: string;
	format: string;
	runtime: string | null;
	lastDeliveryAt: string | null;
	lastSuccessAt: string | null;
}

function badgeClass(status: string): string {
	if (status === "active") return "tool-badge healthy";
	if (status === "paused") return "tool-badge syncing";
	return "tool-badge error";
}

function formatDate(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "none";
}

export function SubscriptionStatusCard({
	subscriptions,
}: {
	subscriptions: SubscriptionStatus[];
}) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					aria-hidden="true"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<path d="M3 4h10M3 8h10M3 12h6" />
				</svg>
				Subscriptions
			</div>
			{subscriptions.length === 0 ? (
				<div className="tool-status-row">
					<span className="tool-status-meta">No subscriptions</span>
				</div>
			) : (
				subscriptions.map((sub) => (
					<div key={sub.id} className="tool-status-row">
						<div className="tool-action-detail">
							<span className="tool-status-name">{sub.name}</span>
							<span className="tool-action-reason">
								{sub.target} · {sub.runtime ?? "none"} · {sub.format}
							</span>
							<span className="tool-action-reason">
								last delivery {formatDate(sub.lastDeliveryAt)} · last success{" "}
								{formatDate(sub.lastSuccessAt)}
							</span>
						</div>
						<span className={badgeClass(sub.status)}>{sub.status}</span>
					</div>
				))
			)}
		</div>
	);
}
