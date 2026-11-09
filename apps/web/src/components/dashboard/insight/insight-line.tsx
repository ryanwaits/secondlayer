"use client";

import { lineOpen } from "@/lib/insight-open";
import { setOpenChoices, useOpenChoices } from "@/lib/insight-open-store";
import {
	type Insight,
	insightHref,
	insightTargetName,
	rankInsights,
	severityDot,
} from "@/lib/insights";
import { useState } from "react";
import { InsightActions } from "./insight-actions";
import { InsightCard } from "./insight-card";

/** The class that colors Why: red for failing, yellow for attention. */
const WHY_TONE: Record<Insight["severity"], string> = {
	losing: "fail",
	will_fail: "att",
	costs: "att",
	recovered: "",
};

/** Where an insight lives, ahead of its line on the Overview, unless the
 *  line already names it. */
function homeTag(i: Insight) {
	const name = insightTargetName(i);
	return i.line.includes(name) ? null : (
		<span className="ins-home">{name}</span>
	);
}

/**
 * A page's insights as one line, worst first: the worst one, "+N more" and
 * Why. Why opens one grouped card: the list on the left, the chosen insight
 * on the right. Shown or hidden is the reader's choice, kept per insight
 * across pages and visits; until they choose, a new insight that is losing
 * events or about to fail opens it. `inbox` is the Overview's: every insight
 * names its home page and links there. Renders nothing for an empty list.
 */
export function InsightLine({
	insights,
	inbox = false,
	id,
	className,
}: {
	insights: readonly Insight[];
	inbox?: boolean;
	/** Spacing from the page around it. */
	className?: string;
	/** Anchor id, for links that scroll to it. */
	id?: string;
}) {
	const saved = useOpenChoices();
	const [chosen, setChosen] = useState<string | null>(null);
	const ranked = rankInsights(insights);
	const worst = ranked[0];
	if (!worst) return null;

	const open = lineOpen(ranked, saved);
	const toggle = () => setOpenChoices(ranked.map((i) => [i.id, !open]));
	const selected = ranked.find((i) => i.id === chosen) ?? worst;
	const extra = ranked.length - 1;
	const panelId = `ins-panel-${worst.id}`;

	return (
		<div className={`ins-line-wrap${className ? ` ${className}` : ""}`} id={id}>
			<button
				type="button"
				className="ins-line"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={toggle}
			>
				<span className={`ins-dot ${severityDot(worst.severity)}`} />
				<span className="ins-line-text">
					{inbox ? homeTag(worst) : null}
					{worst.line}
					{worst.meta ? (
						<span className="ins-line-meta"> · {worst.meta}</span>
					) : null}
					{extra > 0 ? <span className="ins-more"> +{extra} more</span> : null}
				</span>
				<span className={`ins-line-why ${WHY_TONE[worst.severity]}`}>
					{open ? "Hide" : "Why"} ›
				</span>
			</button>
			{open ? (
				<div id={panelId} className={`ins-group${extra > 0 ? "" : " single"}`}>
					{extra > 0 ? (
						<div
							className="ins-group-list"
							role="tablist"
							aria-label="Insights"
						>
							<span className="ins-label ins-group-head">
								{ranked.length} insights · worst first
							</span>
							{ranked.map((i) => (
								<button
									key={i.id}
									type="button"
									role="tab"
									className="ins-group-item"
									aria-selected={i === selected}
									onClick={() => setChosen(i.id)}
								>
									<span className={`ins-dot ${severityDot(i.severity)}`} />
									<span>
										{inbox ? homeTag(i) : null}
										{i.line}
										{i.meta ? <small>{i.meta}</small> : null}
									</span>
								</button>
							))}
						</div>
					) : null}
					<div role={extra > 0 ? "tabpanel" : undefined}>
						<InsightCard
							key={selected.id}
							insight={selected}
							footer={
								<InsightActions
									insight={selected}
									home={
										inbox && insightHref(selected) !== "/account"
											? {
													href: insightHref(selected),
													name: insightTargetName(selected),
												}
											: undefined
									}
								/>
							}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}
