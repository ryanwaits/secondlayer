"use client";

import { NameMark } from "@/components/dashboard/shell/name-mark";
import type { Insight } from "@/lib/insights";
import { handlerErrors24h, stateLine, subgraphTone } from "@/lib/subgraph-view";
import type {
	SubgraphHealthData,
	SubgraphListItem,
} from "@/lib/subgraphs-store";
import Link from "next/link";

import { insightRowState } from "../webhooks/rows";

/** How far a reindex has got, 0 to 100. */
export function reindexPercent(item: SubgraphListItem): number {
	const done = item.lastProcessedBlock;
	const total = done + (item.blocksRemaining ?? 0);
	if (total <= 0) return 0;
	return Math.min(100, Math.max(0, (done / total) * 100));
}

function Chevron() {
	return (
		<svg
			className="msg-chev"
			width="8"
			height="14"
			viewBox="0 0 8 14"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M1 1l6 6-6 6" />
		</svg>
	);
}

/** One subgraph: its name (marked when it needs you), one state line, a meter while it reindexes. A link when `href` is given, else a button. */
export function SubgraphCompactRow({
	item,
	health,
	insights,
	onOpen,
	href,
}: {
	item: SubgraphListItem;
	health: SubgraphHealthData | undefined;
	insights: readonly Insight[];
	onOpen?: (name: string) => void;
	href?: string;
}) {
	const errors24h = handlerErrors24h(health);
	const top = insights[0];
	const insightState = top ? insightRowState(top) : null;
	const tone = insightState?.tone ?? subgraphTone(item.status, errors24h);
	const line =
		insightState?.text ??
		stateLine(
			item.blocksRemaining ?? 0,
			item.totalRows ?? 0,
			errors24h,
			item.status,
		);
	const face = (
		<>
			<span className="msg-main">
				<span className="msg-name" title={item.name}>
					<NameMark tone={tone}>{item.name}</NameMark>
				</span>
				<span className={`msg-line${tone === "alarm" ? " is-bad" : ""}`}>
					{line}
				</span>
				{item.status === "reindexing" ? (
					<span className="msg-meter" aria-hidden="true">
						<i style={{ width: `${reindexPercent(item)}%` }} />
					</span>
				) : null}
			</span>
			<Chevron />
		</>
	);
	return href ? (
		<Link href={href} className="msg-row">
			{face}
		</Link>
	) : (
		<button
			type="button"
			className="msg-row"
			onClick={() => onOpen?.(item.name)}
		>
			{face}
		</button>
	);
}
