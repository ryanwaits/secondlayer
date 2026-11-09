"use client";

import { IntentLink } from "@/components/intent-link";
import type { Insight } from "@/lib/insights";
import { dismiss, markExpected } from "@/lib/insights-store";

/**
 * The footer of an opened insight card: a faint one-line note, the page the
 * insight lives on (Overview only), "Got it" and "This is expected". Both
 * remove the insight at once and the server keeps the choice. A recovered
 * incident can only be dismissed.
 */
export function InsightActions({
	insight,
	home,
}: {
	insight: Insight;
	/** The insight's own page, linked from the Overview's inbox. */
	home?: { href: string; name: string };
}) {
	const recovered = insight.severity === "recovered";
	return (
		<div className="ins-actions">
			<span>
				{recovered
					? "Recovered incidents stay listed for 24 hours."
					: "Clears itself once the numbers are back to normal."}
			</span>
			<span className="ins-actions-btns">
				{home ? (
					<IntentLink className="ins-act-home" href={home.href}>
						Open {home.name} ›
					</IntentLink>
				) : null}
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
