"use client";

import { NameMark } from "@/components/dashboard/shell/name-mark";
import { Sheet } from "@/components/mobile/sheet";
import { formatDate } from "@/lib/account-data";
import { type Insight, rankInsights } from "@/lib/insights";
import {
	runningReplayFor,
	useMinutesLeft,
	useRecentReplays,
} from "@/lib/replays";
import { hostOf } from "@/lib/webhooks-data";
import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookTestResult,
} from "@secondlayer/sdk";
import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import { useState } from "react";
import { DeliveriesChart } from "./deliveries-chart";
import { describeTrigger } from "./describe-trigger";
import { PayloadView, answeredAttempt } from "./payload-view";
import { ReplayProgressView, ReplaySheet } from "./replay-sheet";
import { displayStatus, shortenName } from "./shared";
import { type Recovery, useRecovery } from "./use-recovery";
import {
	ageShort,
	deliveryStats,
	groupAttempts,
	isOk,
	outageStartIndex,
	utcClock,
	utcStamp,
} from "./view";
import { WhatsHappening } from "./whats-happening";

export interface WebhookCompactDetailProps {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	deliveries: DeliveryRow[];
	/** This webhook's insights; the worst one is the What's happening card. */
	insights: readonly Insight[];
	/** The last poll found the hosted stack asleep. */
	stackAsleep: boolean;
	pauseBusy: boolean;
	onTogglePause: () => void;
	test: { busy: boolean; result: WebhookTestResult | null };
	onTest: () => void;
}

/** What the phone detail needs beyond the webhook itself. */
export interface CompactReplayProps {
	/** Dead events since it last succeeded, and the bulk requeue. */
	recovery: Recovery;
	/** This webhook's replay while it runs. */
	replay: { progress: ReplayProgress; minutesLeft: number | null } | null;
	onReplay: () => void;
}

const RECENT_ROWS = 5;

function triggerSentence(webhook: WebhookDetail): string | null {
	const { triggers } = webhook;
	const first = triggers[0];
	if (!first) return null;
	const sentence = describeTrigger(first, 0, triggers)
		.line.map((piece) => piece.text)
		.join("");
	return triggers.length > 1
		? `${sentence} · +${triggers.length - 1} more`
		: sentence;
}

const sumOf = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** The four facts in a 2x2 grid: sent and gave up in the last 24 hours, p95, and since when. */
function Facts({
	webhook,
	activity,
	deliveries,
	failing,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	deliveries: readonly DeliveryRow[];
	failing: boolean;
}) {
	const lastDay = activity?.hours.slice(-24) ?? null;
	const { p95 } = deliveryStats(deliveries);
	const start = failing && activity ? outageStartIndex(activity.hours) : null;
	const since =
		start !== null && activity?.hours[start]
			? utcClock(activity.hours[start].hour)
			: formatDate(webhook.createdAt);
	const fact = (label: string, value: string, bad = false) => (
		<div>
			<span className="mwh-k">{label}</span>
			<span className={`mwh-v${bad ? " is-bad" : ""}`}>{value}</span>
		</div>
	);
	const gaveUp = lastDay ? sumOf(lastDay.map((h) => h.gaveUp)) : null;
	return (
		<div className="mwh-facts">
			{fact(
				"Sent · 24h",
				lastDay
					? sumOf(lastDay.map((h) => h.delivered)).toLocaleString("en-US")
					: "–",
			)}
			{fact(
				"Gave up",
				gaveUp === null ? "–" : gaveUp.toLocaleString("en-US"),
				(gaveUp ?? 0) > 0,
			)}
			{fact("p95", p95 === null ? "–" : `${p95.toLocaleString("en-US")} ms`)}
			{fact("Since", since)}
		</div>
	);
}

/** Why the webhook is quiet when no insight speaks for it: paused, or fine. */
function QuietStatus({
	webhook,
	status,
}: {
	webhook: WebhookDetail;
	status: ReturnType<typeof displayStatus>;
}) {
	return (
		<p className="m-sub">
			{status === "paused"
				? "Paused by you. Events wait until you resume."
				: `Delivering. Last delivery ${ageShort(webhook.lastDeliveryAt)} ago.`}
		</p>
	);
}

/** The last few deliveries; tap one and its payload opens in a sheet. */
function Deliveries({
	webhook,
	deliveries,
	asleep,
}: {
	webhook: WebhookDetail;
	deliveries: readonly DeliveryRow[];
	asleep: boolean;
}) {
	const [openKey, setOpenKey] = useState<string | null>(null);
	const groups = groupAttempts(deliveries).slice(0, RECENT_ROWS);
	const open = groups.find((g) => g.key === openKey);
	if (groups.length === 0) return null;
	const answered = open ? answeredAttempt(open.attempts) : null;
	return (
		<>
			<div className="mwh-sec">
				<b>Deliveries</b>
				<span>tap one for its payload</span>
			</div>
			<ul className="mwh-group mwh-log">
				{groups.map(({ key, latest, attempts }) => (
					<li key={key}>
						<button
							type="button"
							className="mwh-drow"
							onClick={() => setOpenKey(key)}
						>
							<span>{utcClock(latest.dispatchedAt)}</span>
							<span className={isOk(latest) ? "is-ok" : "is-bad"}>
								{latest.statusCode ?? "none"}
								{isOk(latest)
									? latest.durationMs === null
										? ""
										: ` · ${latest.durationMs} ms`
									: attempts.length > 1
										? ` · ${attempts.length} tries`
										: ""}
							</span>
						</button>
					</li>
				))}
			</ul>
			<Sheet
				open={open !== undefined}
				onClose={() => setOpenKey(null)}
				eyebrow={
					open?.latest.blockHeight == null
						? "Test event"
						: `Block ${open.latest.blockHeight.toLocaleString("en-US")}`
				}
				title={open ? `${utcStamp(open.latest.dispatchedAt)} UTC` : ""}
				detents={["half", "full"]}
				initialDetent="full"
			>
				{open && answered ? (
					<PayloadView
						webhookId={webhook.id}
						deliveryId={open.latest.id}
						asleep={asleep}
						triggers={webhook.triggers}
						responseBody={answered.responseBody ?? null}
						statusCode={answered.statusCode}
						responseIsLatest={answered.id === open.latest.id}
						host={hostOf(webhook.url)}
					/>
				) : null}
			</Sheet>
		</>
	);
}

/** The phone detail: facts, what is wrong with the jobs that fix it, the last day, the last deliveries. Pure; `WebhookCompactDetail` feeds it. */
export function WebhookCompactDetailView({
	webhook,
	activity,
	deliveries,
	insights,
	stackAsleep,
	pauseBusy,
	onTogglePause,
	test,
	onTest,
	recovery,
	replay,
	onReplay,
}: WebhookCompactDetailProps & CompactReplayProps) {
	const status = displayStatus(webhook);
	const sentence = triggerSentence(webhook);
	const top = rankInsights([...insights])[0];
	const paused = webhook.status === "paused";
	return (
		<div className="mwh">
			<div className="mwh-title">
				<h2 title={webhook.name}>
					<NameMark
						tone={
							status === "error" ? "alarm" : status === "paused" ? "idle" : "ok"
						}
					>
						{shortenName(webhook.name)}
					</NameMark>
				</h2>
				<button
					type="button"
					className="mwh-pause"
					disabled={pauseBusy}
					onClick={onTogglePause}
				>
					{paused ? "Resume" : "Pause"}
				</button>
			</div>
			{sentence ? <p className="m-sub">{sentence}</p> : null}
			<Facts
				webhook={webhook}
				activity={activity}
				deliveries={deliveries}
				failing={status === "error"}
			/>

			{top ? (
				<WhatsHappening
					compact
					insight={top}
					recovery={recovery}
					onTest={onTest}
					test={test}
				/>
			) : (
				<>
					<QuietStatus webhook={webhook} status={status} />
					<div className="mwh-btns">
						<button
							type="button"
							className="mwh-btn is-wide"
							disabled={test.busy}
							onClick={onTest}
						>
							{test.busy
								? "Sending…"
								: test.result === null
									? "Send a test"
									: test.result.ok
										? `Test got ${test.result.statusCode}`
										: `Test failed: ${test.result.statusCode ?? "no answer"}`}
						</button>
					</div>
				</>
			)}
			<div className="mwh-btns">
				<button type="button" className="mwh-btn is-wide" onClick={onReplay}>
					Replay
				</button>
			</div>

			{replay ? (
				<>
					<div className="mwh-sec">
						<b>Replay</b>
						<span>
							blocks {replay.progress.fromBlock.toLocaleString("en-US")} →{" "}
							{replay.progress.toBlock.toLocaleString("en-US")}
						</span>
					</div>
					<ReplayProgressView
						progress={replay.progress}
						minutesLeft={replay.minutesLeft}
						onRequeue={() => {}}
					/>
				</>
			) : null}

			{activity ? (
				<>
					<div className="mwh-sec">
						<b>Last 24 hours</b>
					</div>
					<div className="mwh-chart">
						<DeliveriesChart
							activity={activity}
							days={undefined}
							range="24h"
							losing={status === "error"}
						/>
					</div>
				</>
			) : null}

			<Deliveries
				webhook={webhook}
				deliveries={deliveries}
				asleep={stackAsleep && paused}
			/>
		</div>
	);
}

/**
 * The phone detail with replay and requeue wired in. Everything that talks to
 * the replay API lives here, so it only runs on a phone.
 */
export function WebhookCompactDetail(props: WebhookCompactDetailProps) {
	const { webhook } = props;
	const [sheetOpen, setSheetOpen] = useState(false);
	const replays = useRecentReplays();
	const running = runningReplayFor(replays, webhook.id);
	const minutesLeft = useMinutesLeft(running);
	const recovery = useRecovery(webhook.id);

	return (
		<>
			<WebhookCompactDetailView
				{...props}
				recovery={recovery}
				replay={running ? { progress: running, minutesLeft } : null}
				onReplay={() => setSheetOpen(true)}
			/>
			<ReplaySheet
				webhook={webhook}
				open={sheetOpen}
				onClose={() => setSheetOpen(false)}
			/>
		</>
	);
}
