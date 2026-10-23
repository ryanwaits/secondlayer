"use client";

import {
	ReplayProgressView,
	useReplayRequeue,
} from "@/components/account/webhooks/replay-sheet";
import {
	type Activity,
	chainBody,
	chainHeadline,
	chainLabel,
	chainRows,
	dismissHint,
} from "@/lib/activity";
import type { ChainTip } from "@/lib/chain-tip";
import { useMinutesLeft } from "@/lib/replays";
import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import Link from "next/link";
import { Sheet } from "./sheet";

/** The drawer title: the one item's headline, or how many things are going on. */
export function activityTitle(items: readonly Activity[]): string {
	const only = items.length === 1 ? items[0] : undefined;
	if (items.length === 0) return "Nothing going on";
	if (!only) return `${items.length} things going on`;
	if (only.kind === "chain") return chainHeadline(only.state);
	if (only.kind === "requeue") return "Requeuing";
	switch (only.progress.status) {
		case "done":
			return "Replay done";
		case "failed":
			return "Replay failed";
		default:
			return "Replay running";
	}
}

function ChainSection({
	item,
	tip,
	now,
	onDismiss,
}: {
	item: Extract<Activity, { kind: "chain" }>;
	tip: ChainTip;
	now: number;
	onDismiss: () => void;
}) {
	return (
		<>
			<div className="m-act-group">
				{chainRows(item.state, tip, now).map(([k, v]) => (
					<div className="m-act-kv" key={k}>
						<span>{k}</span>
						<span>{v}</span>
					</div>
				))}
			</div>
			<p className="m-act-p">{chainBody(item.state)}</p>
			<button type="button" className="mrp-btn" onClick={onDismiss}>
				Dismiss
			</button>
			<p className="m-act-hint">{dismissHint(item.state)}</p>
		</>
	);
}

function ReplaySection({
	progress,
	name,
	onOpen,
	onClear,
}: {
	progress: ReplayProgress;
	name: string;
	onOpen: () => void;
	onClear: () => void;
}) {
	const minutesLeft = useMinutesLeft(progress);
	const { busy, requeue } = useReplayRequeue(progress);
	const active =
		progress.status === "scanning" || progress.status === "running";
	return (
		<>
			<ReplayProgressView
				progress={progress}
				minutesLeft={minutesLeft}
				onRequeue={requeue}
				requeueBusy={busy}
			/>
			{active ? (
				<Link
					className="mrp-btn"
					href={`/account/webhooks/${encodeURIComponent(progress.webhookId)}`}
					onClick={onOpen}
				>
					Open {name}
				</Link>
			) : (
				<button type="button" className="mrp-btn" onClick={onClear}>
					Clear
				</button>
			)}
		</>
	);
}

/**
 * Everything going on, one section per item. The sheet stays mounted while
 * progress ticks; only the values inside change.
 */
export function ActivitySheet({
	open,
	onClose,
	items,
	tip,
	now,
	webhookName,
	onDismissChain,
	onClear,
}: {
	open: boolean;
	onClose: () => void;
	items: readonly Activity[];
	tip: ChainTip;
	now: number;
	webhookName: (id: string) => string;
	onDismissChain: () => void;
	onClear: (replayId: string) => void;
}) {
	const several = items.length > 1;
	return (
		<Sheet
			open={open}
			onClose={onClose}
			eyebrow="Activity"
			title={activityTitle(items)}
		>
			<div className="m-act-body">
				{items.length === 0 ? (
					<p className="m-act-p">
						Replays, requeues and chain problems show up here.
					</p>
				) : null}
				{items.map((item) =>
					item.kind === "chain" ? (
						<section className="m-act-sec" key="chain">
							{several ? <b>{chainLabel(item.state)}</b> : null}
							<ChainSection
								item={item}
								tip={tip}
								now={now}
								onDismiss={onDismissChain}
							/>
						</section>
					) : item.kind === "requeue" ? (
						<section className="m-act-sec" key={`requeue:${item.webhookId}`}>
							{several ? <b>Requeue · {webhookName(item.webhookId)}</b> : null}
							<p className="m-act-p">
								Sending what gave up from {webhookName(item.webhookId)} again.
								They go out with live events.
							</p>
							<Link
								className="mrp-btn"
								href={`/account/webhooks/${encodeURIComponent(item.webhookId)}`}
								onClick={onClose}
							>
								Open {webhookName(item.webhookId)}
							</Link>
						</section>
					) : (
						<section className="m-act-sec" key={item.progress.replayId}>
							{several ? (
								<b>Replay · {webhookName(item.progress.webhookId)}</b>
							) : null}
							<ReplaySection
								progress={item.progress}
								name={webhookName(item.progress.webhookId)}
								onOpen={onClose}
								onClear={() => onClear(item.progress.replayId)}
							/>
						</section>
					),
				)}
			</div>
		</Sheet>
	);
}
