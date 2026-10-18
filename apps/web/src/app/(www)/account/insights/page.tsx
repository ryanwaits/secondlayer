"use client";

import { InsightActions } from "@/components/dashboard/insight/insight-actions";
import { InsightStack } from "@/components/dashboard/insight/insight-stack";
import { rankInsights } from "@/lib/insights";
import { useInsights } from "@/lib/insights-store";

export default function InsightsPage() {
	const { data } = useInsights();
	const open = rankInsights(data.filter((i) => !i.resolvedAt));
	if (open.length === 0) {
		return (
			<p className="acct-muted">
				Nothing needs a look. Insights show up here when something on your stack
				changes.
			</p>
		);
	}
	return (
		<InsightStack
			insights={open}
			footer={(i) => <InsightActions insight={i} />}
		/>
	);
}
