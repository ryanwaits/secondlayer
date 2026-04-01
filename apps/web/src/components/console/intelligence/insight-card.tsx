"use client";

import type { AccountInsight } from "@/lib/types";
import { useCallback, useState } from "react";

const severityClass: Record<string, string> = {
	warning: "insight-warning",
	danger: "insight-danger",
	info: "insight-info",
};

export function InsightCard({
	insight,
	sessionToken,
}: {
	insight: AccountInsight;
	sessionToken: string;
}) {
	const [dismissed, setDismissed] = useState(false);

	const handleDismiss = useCallback(async () => {
		setDismissed(true);
		try {
			const apiUrl = process.env.NEXT_PUBLIC_SL_API_URL || "";
			await fetch(`${apiUrl}/api/insights/${insight.id}/dismiss`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${sessionToken}`,
					"Content-Type": "application/json",
				},
			});
		} catch {
			// Optimistic — already hidden
		}
	}, [insight.id, sessionToken]);

	if (dismissed) return null;

	return (
		<div className={`insight ${severityClass[insight.severity] ?? ""}`}>
			<div>
				<strong>{insight.title}</strong>
				<span style={{ display: "block", marginTop: 2 }}>{insight.body}</span>
			</div>
			<div className="insight-actions">
				<button className="insight-action" onClick={handleDismiss}>
					Dismiss
				</button>
			</div>
		</div>
	);
}
