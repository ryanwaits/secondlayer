"use client";

import { Skel } from "@/components/dashboard/shell/skel";
import { ShareFixSheet } from "@/components/mobile/share/share-fix-sheet";
import { Sheet, SheetPanel } from "@/components/mobile/sheet";
import type { Insight } from "@/lib/insights";
import { forResource, useInsights } from "@/lib/insights-store";
import {
	groupDigits,
	handlerErrors24h,
	isLive,
	subgraphTone,
} from "@/lib/subgraph-view";
import {
	type SubgraphDetailData,
	type SubgraphErrorGroup,
	type SubgraphHealthData,
	type SubgraphListItem,
	refreshDetail,
	refreshErrors,
	useSubgraphsCache,
} from "@/lib/subgraphs-store";
import { type ReactNode, useEffect, useState } from "react";
import { ToneDot } from "../webhooks/rows";
import { utcClock } from "../webhooks/view";

export interface SubgraphSheetBodyProps {
	item: SubgraphListItem;
	/** Undefined until the detail has loaded (the chain tip comes from it). */
	detail: SubgraphDetailData | undefined;
	health: SubgraphHealthData | undefined;
	/** Undefined until the error groups have loaded. */
	errors: readonly SubgraphErrorGroup[] | undefined;
	/** Every insight the server holds; the sheet picks this subgraph's. */
	insights?: readonly Insight[];
	/** Opens the share sheet for the insight. Without it there is no button. */
	onShare?: (insight: Insight) => void;
}

/** The open, non-recovered insight about this subgraph that carries a prompt to hand off. */
export function shareableInsight(
	insights: readonly Insight[],
	name: string,
): Insight | null {
	return (
		forResource(insights, "subgraph", name).find(
			(i) =>
				i.severity !== "recovered" &&
				!i.resolvedAt &&
				i.handoff.prompt.trim() !== "",
		) ?? null
	);
}

function headLabel(item: SubgraphListItem, errors24h: number): string {
	if (errors24h > 0 || item.status === "error") return "Handler errors";
	if (item.status === "reindexing") return "Reindexing";
	if (!isLive(item.blocksRemaining ?? 0)) return "Catching up";
	return "Synced";
}

/** The sheet's title block: status dot and label above, the name below. */
export function sheetHead(
	item: SubgraphListItem,
	health: SubgraphHealthData | undefined,
) {
	const errors24h = handlerErrors24h(health);
	return {
		eyebrow: (
			<>
				<ToneDot tone={subgraphTone(item.status, errors24h)} />
				{headLabel(item, errors24h ?? 0)}
			</>
		),
		title: <span className="msg-title">{item.name}</span>,
	};
}

function shortTx(tx: string): string {
	return tx.length > 14 ? `${tx.slice(0, 6)}…${tx.slice(-4)}` : tx;
}

function Fact({
	label,
	children,
	bad,
}: { label: string; children: ReactNode; bad?: boolean }) {
	return (
		<div className="msg-kv">
			<span>{label}</span>
			<span className={`msg-v${bad ? " is-bad" : ""}`}>{children}</span>
		</div>
	);
}

function Errors({ groups }: { groups: readonly SubgraphErrorGroup[] }) {
	const last = groups.reduce((a, b) => (b.lastSeen > a.lastSeen ? b : a));
	const sample = [
		last.sampleBlockHeight === null
			? null
			: `block ${groupDigits(String(last.sampleBlockHeight))}`,
		last.sampleTxId === null ? null : `tx ${shortTx(last.sampleTxId)}`,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<>
			<div className="msg-sec">
				<b>Errors, 24 h</b>
				<span>
					{groups.length} {groups.length === 1 ? "kind" : "kinds"}
				</span>
			</div>
			<div className="msg-group">
				{groups.map((g) => (
					<div
						className="msg-kv"
						key={`${g.message}|${g.frame}|${g.eventType}`}
					>
						<span className="msg-err" title={g.message}>
							{g.message}
						</span>
						<span className="msg-v msg-count">
							{groupDigits(String(g.count))}
						</span>
					</div>
				))}
			</div>
			<div className="msg-sec">
				<b>Last error</b>
				<span>{utcClock(last.lastSeen)} UTC</span>
			</div>
			<div className="msg-code">
				<span className="is-bad">{last.message}</span>
				{last.frame ? <span className="msg-faint">{last.frame}</span> : null}
				{sample ? <span className="msg-faint">{sample}</span> : null}
			</div>
		</>
	);
}

/**
 * What the sheet shows: lag, rows and errors. Rendered alone by the Lab and
 * tests; `SubgraphSheet` puts it in the sheet. Whether the "drag up" hint shows
 * is CSS on the half detent, so the body does not need to know the detent.
 */
export function SubgraphSheetBody({
	item,
	detail,
	health,
	errors,
	insights = [],
	onShare,
}: SubgraphSheetBodyProps) {
	const errors24h = handlerErrors24h(health);
	const hasErrors = errors !== undefined && errors.length > 0;
	const loadingErrors = errors === undefined && (errors24h ?? 0) > 0;
	const share = onShare ? shareableInsight(insights, item.name) : null;
	return (
		<>
			<div className="msg-group">
				<Fact label="Last block">
					{groupDigits(String(item.lastProcessedBlock))}
				</Fact>
				<Fact label="Chain tip">
					{detail ? groupDigits(String(detail.sync.chainTip)) : "…"}
				</Fact>
				<Fact label="Rows">{groupDigits(String(item.totalRows ?? 0))}</Fact>
				<Fact label="Errors 24h" bad={(errors24h ?? 0) > 0}>
					{errors24h === null ? "…" : groupDigits(String(errors24h))}
				</Fact>
			</div>
			{hasErrors ? <p className="msg-drag">Drag up for the errors</p> : null}
			{loadingErrors ? (
				<div className="msg-skel-block" aria-hidden="true">
					<Skel width="40%" height={14} />
					<Skel width="100%" height={36} />
				</div>
			) : null}
			{hasErrors ? <Errors groups={errors} /> : null}
			{share && onShare ? (
				<button
					type="button"
					className="msg-share"
					onClick={() => onShare(share)}
				>
					Share fix
				</button>
			) : null}
		</>
	);
}

/** The Lab's frame: the sheet markup at a fixed detent, with no portal. */
export function SubgraphSheetPanel({
	detent,
	...props
}: SubgraphSheetBodyProps & { detent: "half" | "full" }) {
	return (
		<SheetPanel {...sheetHead(props.item, props.health)} detent={detent}>
			<SubgraphSheetBody {...props} />
		</SheetPanel>
	);
}

/**
 * A subgraph's facts and error groups in a bottom sheet: half height first,
 * drag up for the errors. Fetches the detail and errors once on open; the
 * list's own polling keeps the rest fresh.
 */
export function SubgraphSheet({
	name,
	onClose,
}: { name: string; onClose: () => void }) {
	const { list, detail, health, errors } = useSubgraphsCache();
	const { data: insights } = useInsights();
	const [sharing, setSharing] = useState<Insight | null>(null);
	useEffect(() => {
		void refreshDetail(name);
		void refreshErrors(name);
	}, [name]);
	const item = list?.data.find((s) => s.name === name);
	if (!item) return null;
	const healthData = health[name]?.data;
	return (
		<>
			<Sheet
				open
				// The share sheet is on top; Escape and its scrim close only that one.
				onClose={sharing ? () => {} : onClose}
				detents={["half", "full"]}
				initialDetent="half"
				{...sheetHead(item, healthData)}
			>
				<SubgraphSheetBody
					item={item}
					detail={detail[name]?.data}
					health={healthData}
					errors={errors[name]?.data}
					insights={insights}
					onShare={setSharing}
				/>
			</Sheet>
			<ShareFixSheet insight={sharing} onClose={() => setSharing(null)} />
		</>
	);
}
