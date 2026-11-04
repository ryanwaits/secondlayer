import type { Insight } from "@/lib/insights";
import type { ReactNode } from "react";
import { InsightCard } from "./insight-card";

/** The class that colors the Why link: yellow for attention, red for failing,
 *  the default for a recovered one. */
const NOTE_TONE: Record<Insight["severity"], string> = {
	losing: "fail",
	will_fail: "att",
	costs: "att",
	recovered: "recovered",
};

/** A collapsed insight: one plain line and "Why ›" / "Hide ›". Opens into the card. */
export function InsightNote({
	insight,
	open,
	onToggle,
	footer,
	label,
}: {
	insight: Insight;
	open: boolean;
	onToggle: () => void;
	/** Rendered at the bottom of the opened card. */
	footer?: ReactNode;
	/** Names the resource ahead of the line, on lists that mix resources. */
	label?: string;
}) {
	const panelId = `ins-panel-${insight.id}`;
	return (
		<div className={`ins-note ${NOTE_TONE[insight.severity]}`}>
			<button
				type="button"
				className="ins-note-row"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={onToggle}
			>
				<span className="ins-note-line">
					{label ? <span className="ins-note-label">{label}</span> : null}
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
