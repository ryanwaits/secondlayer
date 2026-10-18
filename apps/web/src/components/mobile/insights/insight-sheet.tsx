"use client";

import { ageShort } from "@/components/account/webhooks/view";
import { Evidence } from "@/components/dashboard/insight/evidence";
import {
	type Insight,
	SEVERITY_WORD,
	causeText,
	insightHref,
	insightTargetName,
	severityDot,
} from "@/lib/insights";
import Link from "next/link";
import type { ReactNode } from "react";
import { Sheet } from "../sheet";

/** What the sheet shows under its title. Rendered alone by the Lab and tests; `Sheet` portals. */
export function InsightSheetBody({
	insight,
	extraAction,
}: {
	insight: Insight;
	/** Beside the primary action (Share fix). */
	extraAction?: ReactNode;
}) {
	const cause = causeText(insight.how);
	const confidence = insight.how.label?.confidence ?? 0;
	return (
		<>
			<p className="m-ins-text">{insight.body}</p>
			{insight.evidence.map((item) => (
				<Evidence key={`${item.kind}-${item.title}`} item={item} />
			))}
			{cause ? (
				<div className="m-ins-cause">
					<div className="ins-label">
						Likely cause · {Math.round(confidence * 100)}% sure
					</div>
					<p>{cause}</p>
				</div>
			) : null}
			<div className="m-ins-actions">
				<Link href={insightHref(insight)} className="btn btn-pri">
					Open {insightTargetName(insight)}
				</Link>
				{extraAction}
			</div>
		</>
	);
}

export function InsightSheetEyebrow({ insight }: { insight: Insight }) {
	return (
		<>
			<span className={`ins-dot ${severityDot(insight.severity)}`} />
			<span>{SEVERITY_WORD[insight.severity]}</span>
			<span>· {ageShort(insight.resolvedAt ?? insight.createdAt)}</span>
		</>
	);
}

/** An insight in a bottom sheet. Holds no screen state, so Pulse and pushes can open it too. */
export function InsightSheet({
	insight,
	onClose,
	extraAction,
}: {
	insight: Insight | null;
	onClose: () => void;
	extraAction?: ReactNode;
}) {
	return (
		<Sheet
			open={insight !== null}
			onClose={onClose}
			eyebrow={insight ? <InsightSheetEyebrow insight={insight} /> : null}
			title={insight?.lead ?? ""}
			detents="auto"
		>
			{insight ? (
				<InsightSheetBody insight={insight} extraAction={extraAction} />
			) : null}
		</Sheet>
	);
}
