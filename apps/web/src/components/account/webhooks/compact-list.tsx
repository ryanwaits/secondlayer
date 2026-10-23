"use client";

import { NameMark } from "@/components/dashboard/shell/name-mark";
import {
	replayPercent,
	runningReplayFor,
	useRecentReplays,
} from "@/lib/replays";
import Link from "next/link";

import type { WebhookRowModel } from "./rows";
import { shortenName } from "./shared";
import { ageShort, last24 } from "./view";

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
