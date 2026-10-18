"use client";

import {
	recoveryStep3,
	runningReplayFor,
	useMinutesLeft,
	useRecentReplays,
} from "@/lib/replays";
import { getReplays, requeueDead } from "@/lib/webhooks-data";
import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookTestResult,
} from "@secondlayer/sdk";
import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DeliveriesChart } from "./deliveries-chart";
import { describeTrigger } from "./describe-trigger";
import { ReplayProgressView, ReplaySheet } from "./replay-sheet";
import { ToneDot } from "./rows";
import { displayStatus, shortenName } from "./shared";
import { ageShort, isOk, outageStartIndex, utcClock } from "./view";

export interface WebhookCompactDetailProps {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	deliveries: DeliveryRow[];
	pauseBusy: boolean;
	onTogglePause: () => void;
	test: { busy: boolean; result: WebhookTestResult | null };
	onTest: () => void;
}

/** What the phone detail needs beyond the webhook itself. */
export interface CompactReplayProps {
	/** Keep the recovery steps on screen: the webhook was failing and may since have been resumed. */
	showRecovery: boolean;
	/** Dead events since it last succeeded; null until read. */
	dead: { count: number } | null;
	/** The bulk requeue of step 3: in flight, or how many went out. */
	requeue: { busy: boolean; requeued: number | null; onRequeue: () => void };
	/** This webhook's replay while it runs. */
	replay: { progress: ReplayProgress; minutesLeft: number | null } | null;
	onReplay: () => void;
}

const RECENT_ROWS = 4;

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

function Status({
	webhook,
	activity,
	status,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	status: ReturnType<typeof displayStatus>;
}) {
	if (status === "error") {
		const start = activity ? outageStartIndex(activity.hours) : null;
		const since =
			start === null || !activity?.hours[start]
				? ""
				: ` Failing since ${utcClock(activity.hours[start].hour)} UTC.`;
		return (
			<div className="mwh-status">
				<ToneDot tone="alarm" />
				<span className="mwh-status-text">
					<b className="is-bad">Can't reach your server</b>
					<span>
						{webhook.status === "paused"
							? `We paused it after 20 failed attempts in a row.${since}`
							: `Deliveries keep failing.${since}`}
					</span>
				</span>
			</div>
		);
	}
	if (status === "paused") {
		return (
			<div className="mwh-status">
				<ToneDot tone="idle" />
				<span className="mwh-status-text">
					<b>Paused by you</b>
					<span>Events wait until you resume.</span>
				</span>
			</div>
		);
	}
	return (
		<div className="mwh-status">
			<ToneDot tone="ok" />
			<span className="mwh-status-text">
				<b>Delivering</b>
				<span>Last delivery {ageShort(webhook.lastDeliveryAt)} ago.</span>
			</span>
		</div>
	);
}

function Step({
	index,
	done,
	label,
	bad,
	hint,
	children,
}: {
	index: number;
	done: boolean;
	label: string;
	bad?: boolean;
	hint?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className={`mwh-step${done ? " is-done" : ""}`}>
			<span className="mwh-ix" aria-hidden="true">
				{done ? "✓" : index}
			</span>
			<span className={`mwh-lbl${bad ? " is-bad" : ""}`}>
				{label}
				{hint ? <small>{hint}</small> : null}
			</span>
			{children}
		</div>
	);
}

function Recovery({
	webhook,
	test,
	pauseBusy,
	onTest,
	onTogglePause,
	dead,
	requeue,
}: Pick<
	WebhookCompactDetailProps,
	"webhook" | "test" | "pauseBusy" | "onTest" | "onTogglePause"
> &
	Pick<CompactReplayProps, "dead" | "requeue">) {
	const tested = test.result?.ok === true;
	const failed = test.result !== null && !test.result.ok;
	const paused = webhook.status === "paused";
	const testLabel = tested
		? `Test got ${test.result?.statusCode} in ${test.result?.durationMs} ms`
		: failed
			? `Test failed: ${test.result?.statusCode ?? test.result?.error ?? "no answer"}`
			: "Send a test event";
	const resumed = !paused;
	const step3 = dead ? recoveryStep3(dead) : null;
	return (
		<>
			<div className="mwh-sec">
				<b>Get it delivering again</b>
				<span>in order</span>
			</div>
			<div className="mwh-group">
				<Step index={1} done={tested} label={testLabel} bad={failed}>
					{tested ? null : (
						<button
							type="button"
							className="mwh-btn"
							disabled={test.busy}
							onClick={onTest}
						>
							{test.busy ? "Sending…" : "Send test"}
						</button>
					)}
				</Step>
				<Step
					index={2}
					done={resumed}
					label={paused ? "Resume deliveries" : "Deliveries are not paused"}
				>
					{resumed ? null : (
						<button
							type="button"
							className="mwh-btn"
							disabled={!tested || pauseBusy}
							onClick={onTogglePause}
						>
							Resume
						</button>
					)}
				</Step>
				{step3?.kind === "nothing" ? (
					<Step
						index={3}
						done={resumed}
						label="Nothing gave up"
						hint="Waiting events went out when you resumed."
					/>
				) : requeue.requeued !== null ? (
					<Step
						index={3}
						done
						label={`Requeued ${requeue.requeued.toLocaleString("en-US")}`}
					/>
				) : (
					<Step index={3} done={false} label="Requeue what gave up">
						<button
							type="button"
							className="mwh-btn"
							disabled={!resumed || step3 === null || requeue.busy}
							onClick={requeue.onRequeue}
						>
							{step3?.kind === "requeue"
								? `Requeue ${step3.count.toLocaleString("en-US")}`
								: "Requeue"}
						</button>
					</Step>
				)}
			</div>
			{tested ? null : (
				<p className="m-sub mwh-hint">
					Test first. Resuming while your server still fails just pauses it
					again.
				</p>
			)}
		</>
	);
}

/** The phone detail: what is wrong, the steps back to delivering, and the last day. Pure; `WebhookCompactDetail` feeds it. */
export function WebhookCompactDetailView({
	webhook,
	activity,
	deliveries,
	pauseBusy,
	onTogglePause,
	test,
	onTest,
	showRecovery,
	dead,
	requeue,
	replay,
	onReplay,
}: WebhookCompactDetailProps & CompactReplayProps) {
	const status = displayStatus(webhook);
	const sentence = triggerSentence(webhook);
	const waiting = activity?.waiting ?? 0;
	return (
		<div className="mwh">
			<div className="mwh-title">
				<h2 title={webhook.name}>{shortenName(webhook.name)}</h2>
				{sentence ? <p className="m-sub">{sentence}</p> : null}
			</div>
			<div className="mwh-group">
				<Status webhook={webhook} activity={activity} status={status} />
				<div className="mwh-kv">
					<span>Server</span>
					<span className="mwh-mono">
						{webhook.url.replace(/^https?:\/\//, "")}
					</span>
				</div>
				{webhook.lastError ? (
					<div className="mwh-kv">
						<span>Last error</span>
						<span className="mwh-mono is-bad">{webhook.lastError}</span>
					</div>
				) : null}
				{waiting > 0 ? (
					<div className="mwh-kv">
						<span>Waiting to retry</span>
						<span>{waiting.toLocaleString("en-US")}</span>
					</div>
				) : null}
			</div>

			{showRecovery ? (
				<Recovery
					webhook={webhook}
					test={test}
					pauseBusy={pauseBusy}
					onTest={onTest}
					onTogglePause={onTogglePause}
					dead={dead}
					requeue={requeue}
				/>
			) : (
				<div className="mwh-btns">
					<button
						type="button"
						className="mwh-btn is-wide"
						disabled={pauseBusy}
						onClick={onTogglePause}
					>
						{status === "paused" ? "Resume" : "Pause"}
					</button>
					<button
						type="button"
						className="mwh-btn is-wide"
						disabled={test.busy}
						onClick={onTest}
					>
						{test.busy ? "Sending…" : "Send test"}
					</button>
					<button type="button" className="mwh-btn is-wide" onClick={onReplay}>
						Replay
					</button>
				</div>
			)}

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

			{deliveries.length > 0 ? (
				<>
					<div className="mwh-sec">
						<b>Recent deliveries</b>
						<span>time · status · took · block</span>
					</div>
					<div className="mwh-group mwh-log">
						{deliveries.slice(0, RECENT_ROWS).map((row) => (
							<div className="mwh-kv" key={`${row.id}:${row.attempt}`}>
								<span>{utcClock(row.dispatchedAt)}</span>
								<span className={isOk(row) ? "is-ok" : "is-bad"}>
									{row.statusCode ?? "–"}
								</span>
								<span>
									{row.durationMs === null ? "–" : `${row.durationMs} ms`}
								</span>
								<span className="mwh-faint">
									{row.blockHeight === null
										? "test"
										: row.blockHeight.toLocaleString("en-US")}
								</span>
							</div>
						))}
					</div>
				</>
			) : null}
		</div>
	);
}

/**
 * The phone detail with replay and requeue wired in. Everything that talks to
 * the replay API lives here, so it only runs on a phone.
 */
export function WebhookCompactDetail(props: WebhookCompactDetailProps) {
	const { webhook } = props;
	const failing = displayStatus(webhook) === "error";
	// Resuming ends "failing", but the steps stay until the requeue is done.
	const recovering = useRef(false);
	if (failing) recovering.current = true;

	const [dead, setDead] = useState<{
		count: number;
		since: string | null;
	} | null>(null);
	const [requeueBusy, setRequeueBusy] = useState(false);
	const [requeued, setRequeued] = useState<number | null>(null);
	const [sheetOpen, setSheetOpen] = useState(false);
	const replays = useRecentReplays();
	const running = runningReplayFor(replays, webhook.id);
	const minutesLeft = useMinutesLeft(running);
	const id = webhook.id;

	useEffect(() => {
		let cancelled = false;
		getReplays(id).then((res) => {
			if (!cancelled && res.kind === "ok") {
				setDead(res.data.ranges.deadSinceFailing);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [id]);

	const onRequeue = async () => {
		if (requeueBusy) return;
		setRequeueBusy(true);
		const res = await requeueDead(id, { since: dead?.since ?? undefined });
		setRequeueBusy(false);
		if (res.kind !== "ok") {
			toast.error("Couldn't requeue", {
				description:
					res.kind === "error" ? res.message : "Try again in a moment.",
			});
			return;
		}
		const n = res.data.requeued.toLocaleString("en-US");
		toast.success(`Requeued ${n}. They go out with live events.`);
		setRequeued(res.data.requeued);
	};

	return (
		<>
			<WebhookCompactDetailView
				{...props}
				showRecovery={failing || recovering.current}
				dead={dead}
				requeue={{ busy: requeueBusy, requeued, onRequeue }}
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
