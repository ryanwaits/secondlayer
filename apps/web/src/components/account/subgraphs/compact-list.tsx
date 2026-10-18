"use client";

import { Skel } from "@/components/dashboard/shell/skel";
import { StatusSentence } from "@/components/dashboard/shell/status-sentence";
import type { Insight } from "@/lib/insights";
import { forResource } from "@/lib/insights-store";
import {
	groupDigits,
	handlerErrors24h,
	stateLine,
	subgraphTone,
} from "@/lib/subgraph-view";
import type {
	SubgraphHealthData,
	SubgraphListItem,
} from "@/lib/subgraphs-store";
import { ToneDot, insightRowState } from "../webhooks/rows";

/** Why there is no list to show yet. The same shape `useSubgraphsPoll` returns. */
export type CompactListNotice =
	| { kind: "starting" }
	| { kind: "error"; message: string };

export interface SubgraphsCompactListProps {
	/** Null until the first list has loaded. */
	items: readonly SubgraphListItem[] | null;
	health: Record<string, SubgraphHealthData | undefined>;
	/** Every insight the server holds; each row picks its own by name. */
	insights: readonly Insight[];
	notice: CompactListNotice | null;
	onOpen: (name: string) => void;
}

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

function RowSkeleton() {
	return (
		<div className="msg-skel-row" aria-hidden="true">
			<Skel width={8} height={8} style={{ borderRadius: "50%" }} />
			<span className="msg-skel-text">
				<Skel width="46%" height={14} />
				<Skel width="72%" height={12} />
			</span>
		</div>
	);
}

function Row({
	item,
	health,
	insights,
	onOpen,
}: {
	item: SubgraphListItem;
	health: SubgraphHealthData | undefined;
	insights: readonly Insight[];
	onOpen: (name: string) => void;
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
	return (
		<button type="button" className="msg-row" onClick={() => onOpen(item.name)}>
			<ToneDot tone={tone} />
			<span className="msg-main">
				<span className="msg-name" title={item.name}>
					{item.name}
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
		</button>
	);
}

/** The phone list: one row per subgraph, tap to open its sheet. Read-only. */
export function SubgraphsCompactList({
	items,
	health,
	insights,
	notice,
	onOpen,
}: SubgraphsCompactListProps) {
	if (items === null) {
		if (notice?.kind === "starting") {
			return (
				<div className="msg">
					<StatusSentence
						tone="idle"
						sub="Your account gets its own hosted stack the first time you use subgraphs. This takes about 30 seconds."
					>
						Starting your hosted stack.
					</StatusSentence>
				</div>
			);
		}
		if (notice?.kind === "error") {
			return (
				<div className="msg">
					<StatusSentence tone="alarm" sub={notice.message}>
						Couldn't load your subgraphs.
					</StatusSentence>
				</div>
			);
		}
		return (
			<div className="msg">
				<div className="msg-group">
					<RowSkeleton />
					<RowSkeleton />
					<RowSkeleton />
				</div>
			</div>
		);
	}
	if (items.length === 0) {
		return (
			<div className="msg">
				<div className="m-empty">
					<b>No subgraphs yet</b>
					<p>
						A subgraph turns chain events into your own tables. Deploy one from
						your desk.
					</p>
				</div>
			</div>
		);
	}
	const rows = items.reduce((sum, s) => sum + (s.totalRows ?? 0), 0);
	return (
		<div className="msg">
			<p className="m-sub">
				{items.length} {items.length === 1 ? "subgraph" : "subgraphs"} ·{" "}
				{groupDigits(String(rows))} rows
			</p>
			<div className="msg-group">
				{items.map((item) => (
					<Row
						key={item.name}
						item={item}
						health={health[item.name]}
						insights={forResource(insights, "subgraph", item.name)}
						onOpen={onOpen}
					/>
				))}
			</div>
			<p className="m-sub msg-hint">Watch here, fix in code.</p>
		</div>
	);
}
