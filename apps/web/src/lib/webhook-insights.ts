import type {
	DeadRow,
	DeliveryRow,
	DoctorIssue,
	DoctorIssueCode,
	WebhookActivity,
	WebhookDetail,
} from "@secondlayer/sdk";
// Subpath import: the barrel drags `postgres` into the client bundle.
import {
	type DoctorReport,
	buildDoctorReport,
	isSuccessDelivery,
} from "@secondlayer/sdk/webhooks/doctor";
import type { Insight, InsightEvidence, InsightSeverity } from "./insights";
import { hostOf } from "./webhooks-data";

/**
 * Maps the client-side webhook doctor onto the `Insight` contract. A stopgap:
 * when the insights service serves `GET /api/insights`, swap
 * `insightsFromDoctor` for that fetch. Screens only consume `Insight`.
 */

export const PRIMARY_TITLE: Record<DoctorIssueCode, string> = {
	warning: "This webhook can't fire yet",
	paused: "This webhook is paused",
	last_error: "The last delivery failed",
	circuit: "Your receiver is failing",
	dead_letters: "Some events exhausted every retry",
	no_deliveries: "No deliveries yet",
	receiver_rate_limited: "Your receiver is rate-limiting us",
	receiver_down: "Your receiver looks down",
	receiver_rejects: "Your receiver is rejecting deliveries",
	receiver_slow: "Your receiver is slow",
	delivery_lag: "Deliveries are running behind",
};

/** Why each rule fires and over what window: the "How we worked this out" text. */
export const RULE_EXPLANATION: Record<DoctorIssueCode, string> = {
	warning: "Set directly on this webhook by the instance it runs on.",
	paused: "This webhook's status is paused. Nothing is being delivered.",
	last_error: "The most recent delivery attempt returned an error.",
	circuit:
		"Webhook delivery opened the circuit breaker after repeated failures, and pauses briefly between retries.",
	dead_letters:
		"At least one event exhausted every retry and stopped delivering.",
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

/** The window each rule looks at, for the hand-off prompt. */
const RULE_WINDOW: Partial<Record<DoctorIssueCode, string>> = {
	receiver_rate_limited: "the last 100 delivery attempts",
	receiver_down: "the 5 most recent delivery attempts",
	receiver_rejects: "the 5 most recent delivery attempts",
	receiver_slow: "the newest 20 delivery attempts",
	delivery_lag: "the newest 20 delivery attempts",
};

const LOSING: ReadonlySet<DoctorIssueCode> = new Set([
	"receiver_down",
	"receiver_rejects",
	"circuit",
	"dead_letters",
]);
const WILL_FAIL: ReadonlySet<DoctorIssueCode> = new Set([
	"receiver_rate_limited",
	"receiver_slow",
	"delivery_lag",
	"warning",
]);

/** Days before expiry at which a TLS certificate becomes an insight. */
export const CERT_WARN_DAYS = 14;
const DAY_MS = 86_400_000;

function evidenceValue(issue: DoctorIssue, label: string): string | undefined {
	return issue.evidence?.find((e) => e.label === label)?.value;
}

/** The leading integer of an evidence value ("14 of 100" is 14), or 0. */
function leadingNumber(value: string | undefined): number {
	const match = value?.replaceAll(",", "").match(/\d+/);
	return match ? Number(match[0]) : 0;
}

/** The one-line explanation under the title, with the key number. */
function lede(
	issue: DoctorIssue,
	webhook: WebhookDetail,
	deadCount: number,
): string {
	switch (issue.code) {
		case "warning":
			return issue.detail ?? "This webhook can't fire yet.";
		case "last_error":
			return `The last delivery failed: ${issue.detail ?? "unknown error"}.`;
		case "circuit":
			return `Your receiver failed ${webhook.circuitFailures} times in a row, so deliveries are paused briefly between tries.`;
		case "dead_letters":
			return `${deadCount} event${deadCount === 1 ? "" : "s"} exhausted every retry. They stay in the failed list until you requeue them.`;
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

/** Plain text for the user's coding agent: what we saw, never a code change. */
export function handoffPrompt(
	issue: Pick<DoctorIssue, "code" | "evidence" | "fix">,
	webhook: Pick<WebhookDetail, "name" | "url">,
): string {
	const host = hostOf(webhook.url);
	const window = RULE_WINDOW[issue.code];
	const facts = (issue.evidence ?? [])
		.map((e) => `${e.label}: ${e.value}`)
		.join("; ");
	const parts = [
		`My Secondlayer webhook "${webhook.name}" delivers to ${host}.`,
		`${PRIMARY_TITLE[issue.code]}${window ? `, going by ${window}` : ""}.`,
		facts ? `What we saw: ${facts}.` : "",
		issue.fix?.text ?? "",
	];
	return parts.filter(Boolean).join(" ");
}

/** Delivered per hour for the last 24 hours, with the hours that had failures marked. */
function recentHoursEvidence(
	activity: WebhookActivity | null,
): InsightEvidence | null {
	const hours = activity?.hours.slice(-24) ?? [];
	if (!hours.some((h) => h.failed > 0)) return null;
	return {
		kind: "series",
		title: "Deliveries per hour, last 24h",
		series: [
			{ name: "Delivered", role: "a", points: hours.map((h) => h.delivered) },
			{ name: "Failed", role: "mark", points: hours.map((h) => h.failed) },
		],
		labels: [
			[0, "-24h"],
			[Math.max(0, hours.length - 13), "-12h"],
			[Math.max(0, hours.length - 1), "now"],
		],
	};
}

function factsEvidence(issue: DoctorIssue): InsightEvidence | null {
	if (!issue.evidence || issue.evidence.length === 0) return null;
	return {
		kind: "table",
		title: "What we saw",
		columns: ["Fact", "Value"],
		rows: issue.evidence.map((e) => [e.label, e.value]),
	};
}

function impactFor(
	issue: DoctorIssue,
	webhook: WebhookDetail,
	deadCount: number,
	activity: WebhookActivity | null,
): number {
	switch (issue.code) {
		case "dead_letters":
			return deadCount;
		case "receiver_down":
		case "circuit":
			return Math.max(activity?.waiting ?? 0, webhook.circuitFailures);
		case "receiver_rejects":
			return leadingNumber(evidenceValue(issue, "consecutive rejects"));
		case "receiver_rate_limited":
			return leadingNumber(evidenceValue(issue, "429 responses"));
		default:
			return 1;
	}
}

function metaFor(
	issue: DoctorIssue,
	activity: WebhookActivity | null,
): string | undefined {
	if (
		(issue.code === "receiver_down" || issue.code === "circuit") &&
		activity &&
		activity.waiting > 0
	) {
		return `${activity.waiting.toLocaleString("en-US")} waiting to retry`;
	}
	return undefined;
}

function severityFor(
	issue: DoctorIssue,
	deliveries: readonly DeliveryRow[],
): InsightSeverity | null {
	if (issue.code === "paused" || issue.code === "no_deliveries") return null;
	if (issue.code === "last_error") {
		// A newer success means the failure already cleared itself.
		const newest = deliveries[0];
		return newest && isSuccessDelivery(newest) ? null : "losing";
	}
	if (LOSING.has(issue.code)) return "losing";
	if (WILL_FAIL.has(issue.code)) return "will_fail";
	return null;
}

function certInsight(
	webhook: WebhookDetail,
	now: number,
	createdAt: string,
): Insight | null {
	if (!webhook.receiverCertExpiresAt) return null;
	const msLeft = Date.parse(webhook.receiverCertExpiresAt) - now;
	if (!Number.isFinite(msLeft) || msLeft >= CERT_WARN_DAYS * DAY_MS) {
		return null;
	}
	const host = hostOf(webhook.url);
	const days = Math.ceil(msLeft / DAY_MS);
	const expired = msLeft <= 0;
	const date = new Date(webhook.receiverCertExpiresAt).toLocaleDateString(
		"en-US",
		{ month: "short", day: "numeric", timeZone: "UTC" },
	);
	const line = expired
		? `The TLS certificate for ${host} has expired`
		: `The TLS certificate for ${host} expires in ${days} ${days === 1 ? "day" : "days"}`;
	const prompt = `My Secondlayer webhook "${webhook.name}" delivers to ${host}. ${
		expired
			? `The TLS certificate for ${host} expired on ${date} (UTC), so every delivery fails with a TLS error.`
			: `The TLS certificate for ${host} expires on ${date} (UTC), after which every delivery fails with a TLS error.`
	} Find out why the certificate is not renewing automatically and get a new one installed.`;
	return {
		id: `${webhook.id}:tls_cert`,
		rule: "tls_cert",
		severity: expired ? "losing" : "will_fail",
		impact: 1,
		resource: { kind: "webhook", id: webhook.id, name: webhook.name },
		line,
		meta: date,
		lead: expired
			? "The certificate has expired."
			: "The certificate is close to expiring.",
		body: expired
			? `Every delivery to ${host} now fails with a TLS error until a new certificate is installed.`
			: `After ${date}, every delivery to ${host} fails with a TLS error. Renew it before then.`,
		evidence: [],
		handoff: { prompt, commands: [] },
		how: {
			detector: `Rule tls_cert: fires when the receiver's certificate expires in under ${CERT_WARN_DAYS} days.`,
			facts: [["expires", webhook.receiverCertExpiresAt]],
		},
		createdAt,
		resolvedAt: null,
	};
}

/**
 * One insight per doctor issue that is losing events or about to, plus a TLS
 * certificate warning. `paused` and `no_deliveries` are states, not insights.
 */
export function insightsFromDoctor(input: {
	report: Pick<DoctorReport, "issues" | "deadCount">;
	webhook: WebhookDetail;
	deliveries: readonly DeliveryRow[];
	activity: WebhookActivity | null;
	now?: number;
}): Insight[] {
	const { report, webhook, deliveries, activity } = input;
	const now = input.now ?? Date.now();
	const createdAt = new Date(now).toISOString();
	const series = recentHoursEvidence(activity);
	const insights: Insight[] = [];
	for (const issue of report.issues) {
		const severity = severityFor(issue, deliveries);
		if (!severity) continue;
		const facts = factsEvidence(issue);
		insights.push({
			id: `${webhook.id}:${issue.code}`,
			rule: issue.code,
			severity,
			impact: impactFor(issue, webhook, report.deadCount, activity),
			resource: { kind: "webhook", id: webhook.id, name: webhook.name },
			line: PRIMARY_TITLE[issue.code],
			meta: metaFor(issue, activity),
			lead: `${PRIMARY_TITLE[issue.code]}.`,
			body: lede(issue, webhook, report.deadCount),
			evidence: [facts, issue.code === "last_error" ? null : series].filter(
				(e): e is InsightEvidence => e !== null,
			),
			handoff: {
				prompt: handoffPrompt(issue, webhook),
				commands: issue.fix?.command ? [issue.fix.command] : [],
			},
			how: {
				detector: RULE_EXPLANATION[issue.code],
				facts: (issue.evidence ?? []).map((e) => [e.label, e.value]),
			},
			createdAt,
			resolvedAt: null,
		});
	}
	const cert = certInsight(webhook, now, createdAt);
	if (cert) insights.push(cert);
	return insights;
}

/**
 * Insights from whatever the store holds for one webhook. Null until the
 * webhook, its deliveries and its dead letters have all loaded: an empty
 * list while they load would read as "nothing wrong".
 */
export function insightsForWebhook(
	parts: {
		webhook: WebhookDetail | null;
		deliveries: DeliveryRow[] | null;
		dead: DeadRow[] | null;
		activity: WebhookActivity | null;
	},
	now?: number,
): Insight[] | null {
	const { webhook, deliveries, dead, activity } = parts;
	if (!webhook || !deliveries || !dead) return null;
	return insightsFromDoctor({
		report: buildDoctorReport({ webhook, deliveries, dead }),
		webhook,
		deliveries,
		activity,
		now,
	});
}

/**
 * Index of the first hour of the latest outage in `hours`: the run of hours
 * with failures and no deliveries that ends at the newest hour that had any
 * attempt. Null when the newest active hour delivered.
 */
export function outageStartIndex(
	hours: readonly { delivered: number; failed: number }[],
): number | null {
	let end = hours.length - 1;
	while (end >= 0 && hours[end]?.delivered === 0 && hours[end]?.failed === 0) {
		end--;
	}
	let start: number | null = null;
	for (let i = end; i >= 0; i--) {
		const hour = hours[i];
		if (!hour || hour.delivered > 0 || hour.failed === 0) break;
		start = i;
	}
	return start;
}
