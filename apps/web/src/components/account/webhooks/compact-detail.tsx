"use client";

import type {
	DeliveryRow,
	WebhookActivity,
	WebhookDetail,
	WebhookTestResult,
} from "@secondlayer/sdk";
import { DeliveriesChart } from "./deliveries-chart";
import { describeTrigger } from "./describe-trigger";
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
	children,
}: {
	index: number;
	done: boolean;
	label: string;
	bad?: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div className={`mwh-step${done ? " is-done" : ""}`}>
			<span className="mwh-ix" aria-hidden="true">
				{done ? "✓" : index}
			</span>
			<span className={`mwh-lbl${bad ? " is-bad" : ""}`}>{label}</span>
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
}: Pick<
	WebhookCompactDetailProps,
	"webhook" | "test" | "pauseBusy" | "onTest" | "onTogglePause"
>) {
	const tested = test.result?.ok === true;
	const failed = test.result !== null && !test.result.ok;
	const paused = webhook.status === "paused";
	const testLabel = tested
		? `Test got ${test.result?.statusCode} in ${test.result?.durationMs} ms`
		: failed
			? `Test failed: ${test.result?.statusCode ?? test.result?.error ?? "no answer"}`
			: "Send a test event";
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
					done={false}
					label={paused ? "Resume deliveries" : "Deliveries are not paused"}
				>
					<button
						type="button"
						className="mwh-btn"
						disabled={!tested || !paused || pauseBusy}
						onClick={onTogglePause}
					>
						Resume
					</button>
				</Step>
				<Step index={3} done={false} label="Replay what failed">
					<button type="button" className="mwh-btn" disabled>
						Replay
					</button>
				</Step>
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

/** The phone detail: what is wrong, the steps back to delivering, and the last day. */
export function WebhookCompactDetail({
	webhook,
	activity,
	deliveries,
	pauseBusy,
	onTogglePause,
	test,
	onTest,
}: WebhookCompactDetailProps) {
	const status = displayStatus(webhook);
	const failing = status === "error";
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

			{failing ? (
				<Recovery
					webhook={webhook}
					test={test}
					pauseBusy={pauseBusy}
					onTest={onTest}
					onTogglePause={onTogglePause}
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
				</div>
			)}

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
							losing={failing}
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
