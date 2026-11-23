"use client";

import { IntentLink } from "@/components/intent-link";
import type { Insight } from "@/lib/insights";
import { dismiss, markExpected } from "@/lib/insights-store";

export function InsightActions({
	insight,
	home,
}: {
	insight: Insight;
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
