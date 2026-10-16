import { type Insight, severityDot } from "@/lib/insights";
import type { ReactNode } from "react";
import { InsightCard } from "./insight-card";

/** A collapsed insight: dot, one line, and "Why ›" / "Hide ›". Opens into the card. */
export function InsightNote({
	insight,
	open,
	onToggle,
	footer,
}: {
	insight: Insight;
	open: boolean;
	onToggle: () => void;
	/** Rendered at the bottom of the opened card. */
	footer?: ReactNode;
}) {
	const panelId = `ins-panel-${insight.id}`;
	return (
		<div
			className={`ins-note${insight.severity === "recovered" ? " recovered" : ""}`}
		>
			<button
				type="button"
				className="ins-note-row"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<span className={`ins-dot ${severityDot(insight.severity)}`} />
				<span className="ins-note-line">
					<b>{insight.line}</b>
					{insight.meta ? (
						<span className="ins-note-meta"> · {insight.meta}</span>
					) : null}
				</span>
				<span className="ins-note-why">{open ? "Hide" : "Why"} ›</span>
			</button>
			{open ? (
				<div id={panelId}>
					<InsightCard insight={insight} footer={footer} />
				</div>
			) : null}
		</div>
	);
}
