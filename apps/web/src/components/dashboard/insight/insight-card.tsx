import { type Insight, causeText } from "@/lib/insights";
import type { ReactNode } from "react";
import { Evidence } from "./evidence";
import { HandoffBlock } from "./handoff-block";

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
			<HandoffBlock
				prompt={insight.handoff.prompt}
				commands={insight.handoff.commands}
			/>
			<details className="ins-how">
				<summary>How we worked this out</summary>
				<pre className="ins-raw">
					{[
						["detector", how.detector],
						...how.facts,
						...(how.label
							? [
									[
										"label",
										cause
											? `cause=${cause}  confidence ${how.label.confidence}`
											: `cause unknown  confidence ${how.label.confidence}`,
									],
								]
							: []),
					].map(([key, value]) => (
						<span key={key}>
							<span className="k">{key.padEnd(10)}</span>
							{value}
							{"\n"}
						</span>
					))}
				</pre>
			</details>
			{footer ? <div className="ins-foot">{footer}</div> : null}
		</div>
	);
}
