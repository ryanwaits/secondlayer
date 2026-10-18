"use client";

import { ageShort } from "@/components/account/webhooks/view";
import { type Insight, SEVERITY_WORD, severityDot } from "@/lib/insights";
import { SwipeRow } from "../swipe-row";

function RowFace({ insight, isNew }: { insight: Insight; isNew: boolean }) {
	const age = ageShort(insight.resolvedAt ?? insight.createdAt);
	return (
		<span className="m-ins-face">
			<span className="m-ins-top">
				<span className={`ins-dot ${severityDot(insight.severity)}`} />
				<span className="m-ins-word">{SEVERITY_WORD[insight.severity]}</span>
				{isNew ? <span className="m-ins-new">NEW</span> : null}
				<span className="m-ins-age">{age}</span>
			</span>
			<span className="m-ins-lead">{insight.lead}</span>
			{insight.meta ? <span className="m-ins-meta">{insight.meta}</span> : null}
		</span>
	);
}

/**
 * One insight on the phone list. Open rows swipe left for "Until tomorrow"
 * and "Done"; recovered rows only open the sheet.
 */
export function InsightRow({
	insight,
	isNew,
	onOpen,
	onSnooze,
	onDone,
}: {
	insight: Insight;
	isNew: boolean;
	onOpen: () => void;
	onSnooze: () => void;
	onDone: () => void;
}) {
	if (insight.severity === "recovered") {
		return (
			<button type="button" className="m-ins-row" onClick={onOpen}>
				<RowFace insight={insight} isNew={false} />
			</button>
		);
	}
	return (
		<SwipeRow
			id={insight.id}
			onTap={onOpen}
			actions={[
				{ label: "Until tomorrow", tone: "neutral", onAction: onSnooze },
				{ label: "Done", tone: "pri", onAction: onDone },
			]}
		>
			<div className="m-ins-row">
				<RowFace insight={insight} isNew={isNew} />
			</div>
		</SwipeRow>
	);
}
