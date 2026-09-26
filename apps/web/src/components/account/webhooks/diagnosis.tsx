"use client";

import {
	deliveryLagSeries,
	formatUtcDateTime,
	formatUtcTime,
	rateLimitedShareByHour,
	responseTimeHistogram,
} from "@/lib/webhook-graphs";
import type {
	DeliveryRow,
	DoctorIssue,
	DoctorIssueCode,
	WebhookActivity,
	WebhookDetail,
} from "@secondlayer/sdk";
import type { LivelinePoint } from "liveline";
import { LivelineWaitingChart } from "./charts/liveline-waiting-chart";
import { MonoHistogramChart } from "./charts/mono-histogram-chart";
import { MonoLagLineChart } from "./charts/mono-lag-line-chart";
import { MonoShareBarChart } from "./charts/mono-share-bar-chart";
import { CliLine } from "./shared";

/**
 * The webhook detail page's insight card (plan 068). Leads with the single
 * most severe issue (`report.primary`) — title, a one-line lede with the key
 * number, the evidence behind it, and a fix (text, a copyable CLI command
 * when there is one, and a docs link). A "How we worked this out" disclosure
 * names the rule so the reader can verify it themselves.
 *
 * The five deterministic detectors (plan 068) carry `evidence`/`fix` on the
 * issue already; the older flag checks (paused, circuit, ...) don't, so this
 * keeps their existing plain-text copy — never inventing evidence a rule
 * didn't produce.
 */

const PRIMARY_TITLE: Record<DoctorIssueCode, string> = {
	warning: "This webhook can't fire yet",
	paused: "This webhook is paused",
	last_error: "The last delivery failed",
	circuit: "Your receiver is failing",
	dead_letters: "Some events exhausted every retry",
	subgraph_gaps: "The linked subgraph has gaps",
	subgraph_catching_up: "The linked subgraph is still catching up",
	no_deliveries: "No deliveries yet",
	receiver_rate_limited: "Your receiver is rate-limiting us",
	receiver_down: "Your receiver looks down",
	receiver_rejects: "Your receiver is rejecting deliveries",
	receiver_slow: "Your receiver is slow",
	delivery_lag: "Deliveries are running behind",
};

/** Why each rule fires and over what window — the disclosure content. Kept
 *  short: it names the rule, it doesn't re-argue the evidence above it. */
const RULE_EXPLANATION: Record<DoctorIssueCode, string> = {
	warning: "Set directly on this webhook by the instance it runs on.",
	paused: "This webhook's status is paused. Nothing is being delivered.",
	last_error: "The most recent delivery attempt returned an error.",
	circuit:
		"The delivery service opened the circuit breaker after repeated failures, and pauses briefly between retries.",
	dead_letters:
		"At least one event exhausted every retry and stopped delivering.",
	subgraph_gaps:
		"The subgraph feeding this webhook has gaps in its indexed data.",
	subgraph_catching_up:
		"The subgraph feeding this webhook hasn't caught up to the chain tip yet.",
	no_deliveries: "No delivery attempts have been logged for this webhook yet.",
	receiver_rate_limited:
		"Rule receiver_rate_limited: fires when at least 10 of the last 100 delivery attempts are 429s, and 429s are at least half of that window.",
	receiver_down:
		"Rule receiver_down: fires when the 5 most recent attempts are all 5xx responses or got no response at all.",
	receiver_rejects:
		"Rule receiver_rejects: fires when the 5 most recent attempts are all 4xx responses other than 429.",
	receiver_slow:
		"Rule receiver_slow: fires when the median response time of the newest 20 attempts is at least half this webhook's timeout.",
	delivery_lag:
		"Rule delivery_lag: fires when the median time between a block and when we dispatched its event, over the newest 20 attempts, exceeds 60 seconds.",
};

function evidenceValue(issue: DoctorIssue, label: string): string | undefined {
	return issue.evidence?.find((e) => e.label === label)?.value;
}

/** The one-line lede with the key number. The five new detectors read their
 *  own evidence; the older flag checks keep their existing sentence (no
 *  evidence array to draw a number from). */
function primaryLede(
	issue: DoctorIssue,
	webhook: WebhookDetail,
	deadCount: number,
): string {
	switch (issue.code) {
		case "warning":
			return issue.detail ?? "This webhook can't fire yet.";
		case "paused":
			return "Nothing is being delivered. Resume it above when your receiver is healthy.";
		case "last_error":
			return `The last delivery failed: ${issue.detail ?? "unknown error"}.`;
		case "circuit":
			return `Your receiver failed ${webhook.circuitFailures} times in a row, so deliveries are paused briefly between tries.`;
		case "dead_letters":
			return `${deadCount} event${deadCount === 1 ? "" : "s"} exhausted every retry and are waiting in Failed events, below.`;
		case "subgraph_gaps":
			return "The subgraph feeding this webhook has gaps in its data.";
		case "subgraph_catching_up":
			return "The subgraph feeding this webhook is still catching up to the chain tip; new matching rows may arrive later.";
		case "no_deliveries":
			return "No deliveries yet. Confirm your receiver is reachable, then send a test event.";
		case "receiver_rate_limited":
			return `${evidenceValue(issue, "429 responses") ?? "Most"} were 429 responses.`;
		case "receiver_down":
			return `${evidenceValue(issue, "consecutive failures") ?? "Several"} attempts in a row failed.`;
		case "receiver_rejects":
			return `${evidenceValue(issue, "consecutive rejects") ?? "Several"} attempts in a row were rejected.`;
		case "receiver_slow":
			return `Median response time is ${evidenceValue(issue, "median response time") ?? "high"}, close to the ${evidenceValue(issue, "timeout") ?? "configured"} timeout.`;
		case "delivery_lag":
			return `Deliveries are arriving a median of ${evidenceValue(issue, "median lag") ?? "some time"} after the block.`;
		default:
			return "";
	}
}

/** A fix `command` for the five new detectors only; the older flag checks
 *  point at the button already on this page (resume/test), so they carry no
 *  command here. */
function legacyCommand(
	issue: DoctorIssue,
	webhook: WebhookDetail,
): string | undefined {
	if (issue.code === "subgraph_gaps" && webhook.subgraphName) {
		return `secondlayer subgraphs gaps ${webhook.subgraphName}`;
	}
	return undefined;
}

/** Flag graphs (plan 070): shown only for the four codes with a detector
 *  window to visualize, right after the evidence `<dl>`. Every number in a
 *  header is either fixed (a rule's threshold) or read straight from
 *  `primary.evidence` — never recomputed, so it can't disagree with it. */
function FlagGraph({
	primary,
	webhook,
	deliveries,
	activity,
	waitingHistory,
}: {
	primary: DoctorIssue;
	webhook: WebhookDetail;
	deliveries: DeliveryRow[];
	activity: WebhookActivity | null;
	waitingHistory: { t: number; waiting: number }[];
}) {
	if (primary.code === "receiver_down") {
		const points: LivelinePoint[] = waitingHistory.map((p) => ({
			time: Math.floor(p.t / 1000),
			value: p.waiting,
		}));
		const value =
			activity?.waiting ??
			waitingHistory[waitingHistory.length - 1]?.waiting ??
			0;
		const lastSuccessLabel = evidenceValue(primary, "last success");
		return (
			<div className="wh-chart">
				<div className="wh-chart-top">
					<span>
						Events waiting since the last success{" "}
						<span className="wh-live">live</span>
					</span>
					<span className="mono">{value.toLocaleString("en-US")} waiting</span>
				</div>
				<LivelineWaitingChart data={points} value={value} />
				<div className="wh-chart-ends">
					<span>
						{activity?.lastSuccessAt
							? formatUtcTime(activity.lastSuccessAt)
							: (lastSuccessLabel ?? "unknown")}
						, last success
					</span>
					<span>now</span>
				</div>
			</div>
		);
	}

	if (primary.code === "receiver_rate_limited") {
		const hours = rateLimitedShareByHour(deliveries);
		return (
			<div className="wh-chart">
				<div className="wh-chart-top">
					<span>Share of attempts answered 429, per hour</span>
					<span className="mono">dashed line = 50%, the rule's threshold</span>
				</div>
				<MonoShareBarChart hours={hours} />
				<div className="wh-chart-ends">
					<span>oldest</span>
					<span>now</span>
				</div>
			</div>
		);
	}

	if (primary.code === "receiver_slow") {
		const { bins, median } = responseTimeHistogram(
			deliveries,
			webhook.timeoutMs,
		);
		const medianLabel = evidenceValue(primary, "median response time");
		const timeoutLabel = evidenceValue(primary, "timeout");
		return (
			<div className="wh-chart">
				<div className="wh-chart-top">
					<span>Response time, last 100 attempts</span>
					<span className="mono">
						median {medianLabel} · timeout {timeoutLabel}
					</span>
				</div>
				<MonoHistogramChart
					bins={bins}
					median={median}
					timeoutMs={webhook.timeoutMs}
				/>
				<div className="wh-legend">
					<span>
						<i style={{ background: "var(--fig-role-a)" }} />
						median
					</span>
					<span>
						<i style={{ background: "var(--fig-alarm)" }} />
						timeout
					</span>
				</div>
			</div>
		);
	}

	if (primary.code === "delivery_lag") {
		const points = deliveryLagSeries(deliveries);
		const medianLabel = evidenceValue(primary, "median lag");
		return (
			<div className="wh-chart">
				<div className="wh-chart-top">
					<span>Block to delivery, newest 40 events</span>
					<span className="mono">median {medianLabel}</span>
				</div>
				<MonoLagLineChart points={points} />
				<div className="wh-chart-ends">
					<span>older</span>
					<span>dashed line = 60 s, the rule's threshold</span>
					<span>newest</span>
				</div>
			</div>
		);
	}

	return null;
}

export function DiagnosisPanel({
	webhook,
	issues,
	primary,
	deadCount,
	deliveries = [],
	activity = null,
	waitingHistory = [],
}: {
	webhook: WebhookDetail;
	/** The full report — the primary leads the card; everything else
	 *  collapses underneath it (plan 068: one insight per webhook). */
	issues: DoctorIssue[];
	primary: DoctorIssue | null;
	deadCount: number;
	/** The deliveries window already fetched — feeds the flag graphs. */
	deliveries?: DeliveryRow[];
	/** Live queue depth from `/activity` — feeds `receiver_down`'s graph. */
	activity?: WebhookActivity | null;
	/** This page session's `/activity` polls, oldest first — the
	 *  `receiver_down` graph's live series. */
	waitingHistory?: { t: number; waiting: number }[];
}) {
	if (!primary) return null;

	const lede = primaryLede(primary, webhook, deadCount);
	const command = primary.fix?.command ?? legacyCommand(primary, webhook);
	const rest = issues.filter((i) => i !== primary);
	const extraEvidence =
		primary.code === "receiver_down"
			? [
					{
						label: "waiting",
						value: `${(activity?.waiting ?? 0).toLocaleString("en-US")} events`,
					},
					{
						label: "next retry",
						value: activity?.nextAttemptAt
							? formatUtcDateTime(activity.nextAttemptAt)
							: "none scheduled",
					},
				]
			: [];

	return (
		<section
			className={`wh-insight ${primary.severity}`}
			aria-label="Diagnosis"
		>
			<div className="wh-insight-h">
				<p className="t">{PRIMARY_TITLE[primary.code]}</p>
				<p className="l">{lede}</p>
			</div>

			{(primary.evidence && primary.evidence.length > 0) ||
			extraEvidence.length > 0 ? (
				<dl className="wh-insight-evidence">
					{[...(primary.evidence ?? []), ...extraEvidence].map((e) => (
						<div key={e.label}>
							<dt>{e.label}</dt>
							<dd>{e.value}</dd>
						</div>
					))}
				</dl>
			) : null}

			<FlagGraph
				primary={primary}
				webhook={webhook}
				deliveries={deliveries}
				activity={activity}
				waitingHistory={waitingHistory}
			/>

			{primary.fix?.text ? (
				<p className="wh-insight-fix">{primary.fix.text}</p>
			) : null}
			{command ? <CliLine command={command} /> : null}
			{primary.fix?.docsPath ? (
				<p className="acct-fine">
					<a href={primary.fix.docsPath}>Learn more in the docs</a>
				</p>
			) : null}

			<details className="wh-insight-why">
				<summary>How we worked this out</summary>
				<p>{RULE_EXPLANATION[primary.code]}</p>
			</details>

			{rest.length > 0 ? (
				<details className="wh-insight-more">
					<summary>
						{rest.length} more thing{rest.length === 1 ? "" : "s"} to check
					</summary>
					<ul>
						{rest.map((issue) => (
							<li key={issue.code}>
								<strong>{PRIMARY_TITLE[issue.code]}</strong>{" "}
								{primaryLede(issue, webhook, deadCount)}
							</li>
						))}
					</ul>
				</details>
			) : null}
		</section>
	);
}
