"use client";

import { type Insight, autoOpenId, rankInsights } from "@/lib/insights";
import { useState } from "react";
import { Legend } from "../charts/legend";
import { InsightNote } from "./insight-note";

/**
 * Insights on one resource as a ranked list, worst first. Only the top item
 * opens on its own, and only when it is losing events or about to fail. Each
 * note toggles independently.
 */
export function InsightStack({ insights }: { insights: readonly Insight[] }) {
	const [open, setOpen] = useState<ReadonlySet<string>>(() => {
		const id = autoOpenId(insights);
		return new Set(id ? [id] : []);
	});
	if (insights.length === 0) return null;

	const toggle = (id: string) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});

	return (
		<div className="ins-stack">
			<div className="ins-stack-head">
				<span className="ins-label">
					{insights.length} {insights.length === 1 ? "insight" : "insights"} ·
					worst first
				</span>
				<Legend
					items={[
						{ swatch: "square", label: "Losing events now" },
						{ swatch: "square", label: "Will fail", color: "var(--hi)" },
						{ swatch: "square", label: "Costs money", color: "var(--faint)" },
						{ swatch: "ring", label: "Recovered" },
					]}
				/>
			</div>
			{rankInsights(insights).map((insight) => (
				<InsightNote
					key={insight.id}
					insight={insight}
					open={open.has(insight.id)}
					onToggle={() => toggle(insight.id)}
				/>
			))}
		</div>
	);
}
