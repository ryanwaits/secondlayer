"use client";

import { useCallback, useState } from "react";

interface SecretInfo {
	subscriptionName: string;
	subscriptionId: string;
	signingSecret: string;
}

export function SubscriptionSecretCard({ secrets }: { secrets: SecretInfo[] }) {
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const copy = useCallback(async (id: string, secret: string) => {
		await navigator.clipboard.writeText(secret);
		setCopiedId(id);
		setTimeout(() => setCopiedId(null), 1500);
	}, []);

	if (secrets.length === 0) return null;

	return (
		<div className="tool-card">
			<div className="tool-card-header">One-time signing secret</div>
			<div className="tool-status-row">
				<span className="tool-action-reason">
					Copy now and store server-side. This value will not be shown again.
				</span>
			</div>
			{secrets.map((secret) => (
				<div key={secret.subscriptionId} className="tool-action-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">{secret.subscriptionName}</span>
						<code
							className="tool-key-prefix"
							style={{ wordBreak: "break-all" }}
						>
							{secret.signingSecret}
						</code>
					</div>
					<button
						type="button"
						className="tool-btn ghost"
						onClick={() => copy(secret.subscriptionId, secret.signingSecret)}
					>
						{copiedId === secret.subscriptionId ? "Copied" : "Copy"}
					</button>
				</div>
			))}
		</div>
	);
}
