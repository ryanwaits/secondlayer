"use client";

import { NameMark } from "@/components/dashboard/shell/name-mark";
import { Skel } from "@/components/dashboard/shell/skel";
import { SwipeGroup, SwipeRow } from "@/components/mobile/swipe-row";
import {
	replayPercent,
	runningReplayFor,
	useRecentReplays,
} from "@/lib/replays";
import Link from "next/link";
import { useState } from "react";
import { ReplaySheet } from "./replay-sheet";
import type { WebhookRowModel } from "./rows";
import { displayStatus, shortenName } from "./shared";
import { ageShort, last24 } from "./view";

export interface WebhooksCompactListProps {
	/** Null until the first list has loaded. */
	rows: WebhookRowModel[] | null;
	/** Rows whose displayStatus is "error". */
	failing: number;
	/** The webhook whose pause or resume is in flight. */
	busyId: string | null;
	onOpen: (id: string) => void;
	onTogglePause: (row: WebhookRowModel) => void;
}

function Chevron() {
	return (
		<svg
			className="mwh-chev"
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
		<div className="mwh-skel-row" aria-hidden="true">
			<Skel width={8} height={8} style={{ borderRadius: "50%" }} />
			<span className="mwh-skel-text">
				<Skel width="46%" height={14} />
				<Skel width="72%" height={12} />
			</span>
		</div>
	);
}

/** What a webhook row shows: its name (marked when it needs you), one state line, and the count on the right. */
function RowFace({
	row,
	replaying,
	count,
	stopped = false,
}: {
	row: WebhookRowModel;
	replaying?: ReturnType<typeof runningReplayFor>;
	/** Deliveries in the last 24 hours, when the row shows them. */
	count?: string;
	/** The hosted stack is stopped: nothing is delivering, and the webhook isn't at fault. */
	stopped?: boolean;
}) {
	const { webhook, state } = row;
	const tone = stopped ? "idle" : replaying ? "ok" : state.tone;
	const text = stopped
		? "Not delivering, stack stopped"
		: replaying
			? `Replaying ${replayPercent(replaying)}%`
			: state.text;
	return (
		<div className="mwh-row">
			<span className="mwh-main">
				<span className="mwh-name" title={webhook.name}>
					<NameMark tone={tone}>{shortenName(webhook.name)}</NameMark>
				</span>
				<span
					className={`mwh-state${state.bad && !replaying && !stopped ? " is-bad" : ""}`}
				>
					{text}
				</span>
				{state.tone === "ok" &&
				!replaying &&
				!stopped &&
				webhook.lastDeliveryAt ? (
					<span className="mwh-last">
						last {ageShort(webhook.lastDeliveryAt)}
					</span>
				) : null}
			</span>
			{count !== undefined ? (
				<span className="mwh-count">{count}</span>
			) : (
				<Chevron />
			)}
		</div>
	);
}

/** A webhook on the Account page: one tap opens its page. */
export function WebhookCompactRow({
	row,
	stopped,
}: { row: WebhookRowModel; stopped?: boolean }) {
	const replays = useRecentReplays();
	const sent = last24(row.series).delivered.reduce((a, b) => a + b, 0);
	return (
		<Link href={`/account/webhooks/${row.webhook.id}`} className="mwh-link">
			<RowFace
				row={row}
				replaying={runningReplayFor(replays, row.webhook.id)}
				count={sent.toLocaleString("en-US")}
				stopped={stopped}
			/>
		</Link>
	);
}

/** The phone list: swipe a webhook left to pause, resume or replay it, tap to open it. */
export function WebhooksCompactList({
	rows,
	failing,
	busyId,
	onOpen,
	onTogglePause,
}: WebhooksCompactListProps) {
	const replays = useRecentReplays();
	const [replayFor, setReplayFor] = useState<WebhookRowModel["webhook"] | null>(
		null,
	);
	if (rows === null) {
		return (
			<div className="mwh">
				<div className="mwh-group">
					<RowSkeleton />
					<RowSkeleton />
					<RowSkeleton />
				</div>
			</div>
		);
	}
	if (rows.length === 0) {
		return (
			<div className="mwh">
				<div className="m-empty">
					<b>No webhooks yet</b>
					<p>
						Webhooks send chain events to your server. Create one from your
						desk; you'll watch it here.
					</p>
				</div>
			</div>
		);
	}
	return (
		<div className="mwh">
			<p className="m-sub">
				{rows.length} webhooks{failing > 0 ? ` · ${failing} failing` : ""}
			</p>
			<SwipeGroup>
				<div className="mwh-group">
					{rows.map((row) => {
						const { webhook, state } = row;
						const running = displayStatus(webhook) === "active";
						const replaying = runningReplayFor(replays, webhook.id);
						return (
							<SwipeRow
								key={webhook.id}
								id={webhook.id}
								onTap={() => onOpen(webhook.id)}
								actions={[
									{
										label:
											busyId === webhook.id
												? "…"
												: running
													? "Pause"
													: "Resume",
										tone: running ? "neutral" : "pri",
										onAction: () => {
											if (busyId === null) onTogglePause(row);
										},
									},
									{
										label: "Replay",
										tone: "pri",
										onAction: () => setReplayFor(webhook),
									},
								]}
							>
								<RowFace row={row} replaying={replaying} />
							</SwipeRow>
						);
					})}
				</div>
			</SwipeGroup>
			<p className="m-sub mwh-hint">
				Swipe left on a webhook for Pause and Replay.
			</p>
			{replayFor ? (
				<ReplaySheet
					webhook={replayFor}
					open
					onClose={() => setReplayFor(null)}
				/>
			) : null}
		</div>
	);
}
