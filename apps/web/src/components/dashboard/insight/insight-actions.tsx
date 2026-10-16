"use client";

import { type Insight, autoOpenId } from "@/lib/insights";
import { dismiss, markExpected } from "@/lib/insights-store";
import { useState } from "react";
import { InsightNote } from "./insight-note";
import { InsightStack } from "./insight-stack";

/**
 * The footer of an opened insight card: a faint one-line note, "Got it" and
 * "This is expected". Both remove the insight at once and the server keeps
 * the choice. A recovered incident can only be dismissed.
 */
export function InsightActions({ insight }: { insight: Insight }) {
	const recovered = insight.severity === "recovered";
	return (
		<div className="ins-actions">
			<span>
				{recovered
					? "Recovered incidents stay listed for 24 hours."
					: "Clears itself once the numbers are back to normal."}
			</span>
			<span className="ins-actions-btns">
				<button
					type="button"
					className="ins-act"
					onClick={() => void dismiss(insight.id)}
				>
					Got it
				</button>
				{recovered ? null : (
					<button
						type="button"
						className="ins-act"
						onClick={() => void markExpected(insight.id)}
					>
						This is expected
					</button>
				)}
			</span>
		</div>
	);
}

const actionsFooter = (insight: Insight) => (
	<InsightActions insight={insight} />
);

function SingleInsight({ insight }: { insight: Insight }) {
	const [open, setOpen] = useState(autoOpenId([insight]) !== null);
	return (
		<div className="ins-stack">
			<InsightNote
				insight={insight}
				open={open}
				onToggle={() => setOpen((v) => !v)}
				footer={<InsightActions insight={insight} />}
			/>
		</div>
	);
}

/**
 * The insights on one resource or slot, each card ending in the actions. One
 * insight is a bare note (the stack header would only say "1 insight"); two
 * or more are the ranked stack. Renders nothing for an empty list.
 */
export function ActionableInsights({
	insights,
}: { insights: readonly Insight[] }) {
	if (insights.length === 0) return null;
	const only = insights[0];
	if (insights.length === 1 && only) return <SingleInsight insight={only} />;
	return <InsightStack insights={insights} footer={actionsFooter} />;
}
