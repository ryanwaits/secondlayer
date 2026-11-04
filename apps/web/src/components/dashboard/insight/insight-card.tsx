import { type Insight, causeText } from "@/lib/insights";
import { Fragment, type ReactNode } from "react";
import { Evidence } from "./evidence";
import { HandoffBlock } from "./handoff-block";

/** The detector's rule, as a sentence. */
const sentence = (rule: string): string =>
	rule
		? `${rule[0]?.toUpperCase()}${rule.slice(1)}${/[.!?]$/.test(rule) ? "" : "."}`
		: rule;

/** A bare count reads with digit groups (1361 → 1,361); anything else as is. */
const factValue = (value: string): string =>
	/^\d{4,}$/.test(value) ? Number(value).toLocaleString("en-US") : value;

/**
 * One insight, opened: what we saw, the evidence, a hand-off for the user's
 * agent, and how we got there. The cause is named only at confidence >= 0.85;
 * below that the card says "Cause unknown" and shows the facts.
 */
export function InsightCard({
	insight,
	footer,
}: {
	insight: Insight;
	footer?: ReactNode;
}) {
	const { how, evidence } = insight;
	const cause = causeText(how);
	const unknown = how.label && !cause ? how.label : null;
	const evidenceBlocks = evidence.map((item) => (
		<Evidence key={`${item.kind}-${item.title}`} item={item} />
	));
	return (
		<div className="ins-card">
			<p className="ins-what">
				<b>{insight.lead}</b> {insight.body}
			</p>
			{evidence.length >= 2 ? (
				<div className="ins-grid">{evidenceBlocks}</div>
			) : (
				evidenceBlocks
			)}
			{unknown ? (
				<div className="ins-step">
					<div className="ins-label">Cause unknown</div>
					<p className="ins-cause">
						Confidence is {unknown.confidence}, below 0.85, so we don't name a
						cause. The facts are below.
					</p>
				</div>
			) : null}
			{insight.handoff.prompt ? (
				<HandoffBlock
					prompt={insight.handoff.prompt}
					commands={insight.handoff.commands}
				/>
			) : null}
			<details className="ins-how">
				<summary>How we worked this out</summary>
				<div className="ins-raw">
					<p className="ins-rule">{sentence(how.detector)}</p>
					<dl>
						{[
							...how.facts,
							...(how.label
								? [
										[
											"cause",
											`${cause ?? "unknown"} · confidence ${how.label.confidence}`,
										],
									]
								: []),
						].map(([key, value]) => (
							<Fragment key={key}>
								<dt>{key}</dt>
								<dd>{factValue(value)}</dd>
							</Fragment>
						))}
					</dl>
				</div>
			</details>
			{footer ? <div className="ins-foot">{footer}</div> : null}
		</div>
	);
}
