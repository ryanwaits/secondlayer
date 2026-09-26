import type { SubgraphDetail } from "@secondlayer/shared/schemas/subgraphs";
import type {
	DeadRow,
	DeliveryRow,
	WebhookDetail,
	WebhookSummary,
} from "@secondlayer/shared/schemas/webhooks";

/**
 * Webhook diagnosis, shared by `secondlayer webhooks doctor` and the
 * dashboard's webhook detail page. Moved out of the CLI (unchanged behavior)
 * so the web can build the same judgment without printing CLI-command text.
 *
 * Plan 068 adds five deterministic, numbers-only detectors on top of the
 * existing flag checks: no model, no history beyond the deliveries window
 * already fetched. Thresholds are named constants below, conservative on
 * purpose — a wrong insight costs more trust than a missed one.
 */

export function isSuccessDelivery(row: DeliveryRow): boolean {
	return (
		row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300
	);
}

export type DoctorSeverity = "bad" | "warn" | "calm";

export interface DoctorEvidence {
	label: string;
	value: string;
}

export interface DoctorFix {
	text: string;
	/** A `secondlayer webhooks ...` command the reader can copy. */
	command?: string;
	/** Anchor into the docs' webhooks troubleshooting section. */
	docsPath?: string;
}

export type DoctorIssueCode =
	| "warning"
	| "paused"
	| "last_error"
	| "circuit"
	| "dead_letters"
	| "subgraph_gaps"
	| "subgraph_catching_up"
	| "no_deliveries"
	| "receiver_rate_limited"
	| "receiver_down"
	| "receiver_rejects"
	| "receiver_slow"
	| "delivery_lag";

export interface DoctorIssue {
	code: DoctorIssueCode;
	detail?: string;
	severity: DoctorSeverity;
	/** 2-4 numbers-only facts backing the issue. Only the five new detectors
	 *  and the list-summary circuit issue carry this — the older flag checks
	 *  keep their plain `detail` string. */
	evidence?: DoctorEvidence[];
	fix?: DoctorFix;
}

export interface DoctorReport {
	webhook: WebhookDetail;
	deliverySummary: {
		total: number;
		successful: number;
		failed: number;
		last: DeliveryRow | null;
	};
	deadCount: number;
	subgraph: {
		name: string;
		status: string;
		syncStatus: string;
		lastProcessedBlock: number;
		chainTip: number;
		gapCount: number;
		integrity: string;
	} | null;
	/** CLI-facing next steps, one per issue, in the same order as `issues`. */
	hints: string[];
	issues: DoctorIssue[];
	/** The single most severe issue (bad > warn > calm, then rule priority),
	 *  or `null` when there are none. The UI leads with this and collapses
	 *  the rest underneath. */
	primary: DoctorIssue | null;
}

// ── Detector thresholds ─────────────────────────────────────────────
// Named constants, not config (plan 068). Tune from real data at the 054
// spike — until then these stay conservative.

const RATE_LIMITED_MIN_ATTEMPTS = 10;
const RATE_LIMITED_MIN_RATIO = 0.5;
// Exported: the status pill's "auto-failing" rule (plan 070) reuses this
// instead of duplicating the number.
export const DOWN_MIN_CONSECUTIVE = 5;
const REJECTS_MIN_CONSECUTIVE = 5;
const SLOW_WINDOW = 20;
const SLOW_MIN_SAMPLES = 5;
const SLOW_TIMEOUT_RATIO = 0.5;
const LAG_WINDOW = 20;
const LAG_MIN_SAMPLES = 5;
const LAG_THRESHOLD_MS = 60_000;
const ERROR_SNIPPET_MAX = 200;

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[idx] ?? 0;
}

function formatMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** "2026-04-23 00:00 UTC" — date, hour:minute, and an explicit zone so an
 *  evidence value never reads as local time. */
function formatShortDate(iso: string): string {
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** The longest run from the start of `rows` (newest-first) matching
 *  `predicate` — the current losing (or rejecting) streak. */
function consecutiveFromStart(
	rows: DeliveryRow[],
	predicate: (row: DeliveryRow) => boolean,
): DeliveryRow[] {
	const out: DeliveryRow[] = [];
	for (const row of rows) {
		if (!predicate(row)) break;
		out.push(row);
	}
	return out;
}

function summarizeStatusBreakdown(rows: DeliveryRow[]): string {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const key =
			row.statusCode === null ? "timeout/no response" : String(row.statusCode);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()].map(([key, n]) => `${n}× ${key}`).join(", ");
}

const RETRY_AFTER_RE = /retry-after:?\s*(\d+)/i;

/** The most recent 429's `Retry-After`, if the receiver's error text carried
 *  one — we never invent a value the rows didn't report. */
function extractRetryAfterSeconds(rows: DeliveryRow[]): string | null {
	for (const row of rows) {
		if (row.statusCode !== 429 || !row.errorMessage) continue;
		const match = row.errorMessage.match(RETRY_AFTER_RE);
		if (match?.[1]) return match[1];
	}
	return null;
}

/** ≥10 attempts in the window, ≥50% of them 429 — the receiver is
 *  rate-limiting us, not failing. */
function detectReceiverRateLimited(
	webhook: WebhookDetail,
	deliveries: DeliveryRow[],
): DoctorIssue | null {
	if (deliveries.length < RATE_LIMITED_MIN_ATTEMPTS) return null;
	const count429 = deliveries.filter((d) => d.statusCode === 429).length;
	if (count429 / deliveries.length < RATE_LIMITED_MIN_RATIO) return null;

	const oldest = deliveries[deliveries.length - 1];
	const newest = deliveries[0];
	const evidence: DoctorEvidence[] = [
		{
			label: "429 responses",
			value: `${count429} of ${deliveries.length} attempts`,
		},
		{
			label: "window",
			value:
				oldest && newest
					? `${formatShortDate(oldest.dispatchedAt)} → ${formatShortDate(newest.dispatchedAt)}`
					: "unknown",
		},
	];
	const retryAfter = extractRetryAfterSeconds(deliveries);
	if (retryAfter) {
		evidence.push({ label: "latest Retry-After", value: `${retryAfter}s` });
	}

	const suggestedConcurrency = Math.max(1, Math.floor(webhook.concurrency / 2));
	return {
		code: "receiver_rate_limited",
		severity: "warn",
		evidence,
		fix: {
			text: "Lower concurrency, or honor the Retry-After header on your receiver.",
			command: `secondlayer webhooks update ${webhook.id} --concurrency ${suggestedConcurrency}`,
			docsPath: "/docs/webhooks#receiver-rate-limited",
		},
	};
}

/** ≥5 most recent attempts are 5xx or got no response at all (timeout /
 *  connection failure) — the receiver looks down, not just slow. */
function detectReceiverDown(
	webhook: WebhookDetail,
	deliveries: DeliveryRow[],
): DoctorIssue | null {
	const streak = consecutiveFromStart(
		deliveries,
		(d) => d.statusCode === null || d.statusCode >= 500,
	);
	if (streak.length < DOWN_MIN_CONSECUTIVE) return null;

	return {
		code: "receiver_down",
		severity: "bad",
		evidence: [
			{ label: "consecutive failures", value: String(streak.length) },
			{ label: "breakdown", value: summarizeStatusBreakdown(streak) },
			{
				label: "last success",
				value: webhook.lastSuccessAt
					? formatShortDate(webhook.lastSuccessAt)
					: "never",
			},
		],
		fix: {
			text: "Check your receiver's health and logs, then send a test event.",
			command: `secondlayer webhooks test ${webhook.id}`,
			docsPath: "/docs/webhooks#receiver-down",
		},
	};
}

/** ≥5 most recent attempts are 4xx other than 429 — the receiver is
 *  reachable but actively rejecting us (auth, signature, bad request). */
function detectReceiverRejects(
	webhook: WebhookDetail,
	deliveries: DeliveryRow[],
): DoctorIssue | null {
	const streak = consecutiveFromStart(
		deliveries,
		(d) =>
			d.statusCode !== null &&
			d.statusCode >= 400 &&
			d.statusCode < 500 &&
			d.statusCode !== 429,
	);
	if (streak.length < REJECTS_MIN_CONSECUTIVE) return null;

	const evidence: DoctorEvidence[] = [
		{ label: "consecutive rejects", value: String(streak.length) },
		{ label: "breakdown", value: summarizeStatusBreakdown(streak) },
	];
	const withText = streak.find((d) => d.errorMessage || d.responseBody);
	const snippet = withText
		? (withText.errorMessage ?? withText.responseBody ?? "").slice(
				0,
				ERROR_SNIPPET_MAX,
			)
		: null;
	if (snippet) evidence.push({ label: "first error", value: snippet });

	return {
		code: "receiver_rejects",
		severity: "bad",
		evidence,
		fix: {
			text: "Check your receiver's auth config or signature verification.",
			command: `secondlayer webhooks test ${webhook.id}`,
			docsPath: "/docs/webhooks#receiver-rejects",
		},
	};
}

/** Median response time of the newest 20 attempts is at least half the
 *  webhook's timeout — deliveries are slow, not failing. */
function detectReceiverSlow(
	webhook: WebhookDetail,
	deliveries: DeliveryRow[],
): DoctorIssue | null {
	const durations = deliveries
		.slice(0, SLOW_WINDOW)
		.map((d) => d.durationMs)
		.filter((d): d is number => d !== null);
	if (durations.length < SLOW_MIN_SAMPLES) return null;

	const med = median(durations);
	if (med < webhook.timeoutMs * SLOW_TIMEOUT_RATIO) return null;

	return {
		code: "receiver_slow",
		severity: "warn",
		evidence: [
			{ label: "median response time", value: formatMs(med) },
			{
				label: "p95 response time",
				value: formatMs(percentile(durations, 0.95)),
			},
			{ label: "timeout", value: formatMs(webhook.timeoutMs) },
		],
		fix: {
			text: "Speed up your receiver, or raise the timeout (up to 30s hosted).",
			command: `secondlayer webhooks update ${webhook.id} --timeout-ms 30000`,
			docsPath: "/docs/webhooks#receiver-slow",
		},
	};
}

/** Median (dispatch time − block time) of the newest 20 attempts with a
 *  known block time exceeds a minute — we're behind on delivery. This is
 *  our-side latency, not something the receiver can fix, so it carries no
 *  actionable command. */
function detectDeliveryLag(deliveries: DeliveryRow[]): DoctorIssue | null {
	const window = deliveries
		.slice(0, LAG_WINDOW)
		.filter(
			(d): d is DeliveryRow & { blockTime: string } => d.blockTime !== null,
		);
	if (window.length < LAG_MIN_SAMPLES) return null;

	const lags = window.map(
		(d) => new Date(d.dispatchedAt).getTime() - new Date(d.blockTime).getTime(),
	);
	const med = median(lags);
	if (med <= LAG_THRESHOLD_MS) return null;

	const blockTimes = window.map((d) => d.blockTime).sort();
	const oldest = blockTimes[0];
	const newest = blockTimes[blockTimes.length - 1];

	return {
		code: "delivery_lag",
		severity: "warn",
		evidence: [
			{ label: "median lag", value: formatMs(med) },
			{
				label: "block time range",
				value:
					oldest && newest
						? `${formatShortDate(oldest)} → ${formatShortDate(newest)}`
						: "unknown",
			},
		],
		fix: {
			text: "We're behind on delivery; no action needed on your end.",
		},
	};
}

const SEVERITY_RANK: Record<DoctorSeverity, number> = {
	bad: 0,
	warn: 1,
	calm: 2,
};

/** Tie-break within a severity tier when more than one issue fires at
 *  once — most specific / most actionable first. */
const CODE_PRIORITY: DoctorIssueCode[] = [
	"circuit",
	"receiver_down",
	"receiver_rejects",
	"dead_letters",
	"paused",
	"last_error",
	"warning",
	"receiver_rate_limited",
	"receiver_slow",
	"delivery_lag",
	"no_deliveries",
	"subgraph_gaps",
	"subgraph_catching_up",
];

function pickPrimary(issues: DoctorIssue[]): DoctorIssue | null {
	if (issues.length === 0) return null;
	return (
		[...issues].sort((a, b) => {
			const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
			if (sevDiff !== 0) return sevDiff;
			return CODE_PRIORITY.indexOf(a.code) - CODE_PRIORITY.indexOf(b.code);
		})[0] ?? null
	);
}

function hintFor(issue: DoctorIssue): string {
	if (!issue.fix) return issue.detail ?? issue.code;
	return issue.fix.command
		? `${issue.fix.text} ${issue.fix.command}`
		: issue.fix.text;
}

export function buildDoctorReport(input: {
	webhook: WebhookDetail;
	deliveries: DeliveryRow[];
	dead: DeadRow[];
	subgraph?: SubgraphDetail | null;
}): DoctorReport {
	const successful = input.deliveries.filter(isSuccessDelivery).length;
	const failed = input.deliveries.length - successful;
	const subgraph = input.subgraph
		? {
				name: input.subgraph.name,
				status: input.subgraph.status,
				syncStatus: input.subgraph.sync.status,
				lastProcessedBlock: input.subgraph.sync.lastProcessedBlock,
				chainTip: input.subgraph.sync.chainTip,
				gapCount: input.subgraph.sync.gaps.count,
				integrity: input.subgraph.sync.integrity,
			}
		: null;

	const hints: string[] = [];
	const issues: DoctorIssue[] = [];
	if (input.webhook.warning) {
		hints.push(input.webhook.warning);
		issues.push({
			code: "warning",
			detail: input.webhook.warning,
			severity: "warn",
		});
	}
	if (input.webhook.status === "paused") {
		hints.push(
			`Resume when the receiver is healthy: secondlayer webhooks resume ${input.webhook.id}`,
		);
		issues.push({ code: "paused", severity: "warn" });
	}
	if (input.webhook.lastError) {
		hints.push(
			"Run secondlayer webhooks test to reproduce the receiver request.",
		);
		issues.push({
			code: "last_error",
			detail: input.webhook.lastError,
			severity: "warn",
		});
	}
	if (input.webhook.circuitOpenedAt || input.webhook.circuitFailures > 0) {
		hints.push(
			"Circuit breaker has failures; inspect receiver logs and delivery status codes.",
		);
		issues.push({ code: "circuit", severity: "bad" });
	}
	if (input.dead.length > 0) {
		hints.push(
			`Dead-letter rows exist; inspect with secondlayer webhooks dead ${input.webhook.id} and requeue selected rows.`,
		);
		issues.push({ code: "dead_letters", severity: "bad" });
	}
	if (subgraph?.gapCount && subgraph.gapCount > 0) {
		hints.push(
			`Linked subgraph has gaps; run secondlayer subgraphs gaps ${input.webhook.subgraphName}.`,
		);
		issues.push({ code: "subgraph_gaps", severity: "calm" });
	}
	if (subgraph?.syncStatus === "catching_up") {
		hints.push(
			"Linked subgraph is still catching up; new matching rows may arrive later.",
		);
		issues.push({ code: "subgraph_catching_up", severity: "calm" });
	}

	for (const detector of [
		detectReceiverRateLimited,
		detectReceiverDown,
		detectReceiverRejects,
		detectReceiverSlow,
	]) {
		const issue = detector(input.webhook, input.deliveries);
		if (issue) {
			issues.push(issue);
			hints.push(hintFor(issue));
		}
	}
	const lagIssue = detectDeliveryLag(input.deliveries);
	if (lagIssue) {
		issues.push(lagIssue);
		hints.push(hintFor(lagIssue));
	}

	if (input.deliveries.length === 0) {
		hints.push(
			"No deliveries yet; confirm the table is receiving inserted rows that match the filter.",
		);
		issues.push({ code: "no_deliveries", severity: "calm" });
	}
	if (hints.length === 0) {
		hints.push("No immediate action needed.");
	}

	return {
		webhook: input.webhook,
		deliverySummary: {
			total: input.deliveries.length,
			successful,
			failed,
			last: input.deliveries[0] ?? null,
		},
		deadCount: input.dead.length,
		subgraph,
		hints,
		issues,
		primary: pickPrimary(issues),
	};
}

/**
 * The list page's own reduced detector: computed from `WebhookSummary` alone
 * (no deliveries, no dead-letter rows — the list endpoint returns neither,
 * and fetching per-row detail or deliveries here would fan out one request
 * per row). Only `status` and `circuitOpenedAt` distinguish a real problem
 * from a manual pause at this level; deliveries-based rules (rate limits,
 * downtime, rejects, slowness, lag) only ever show on the detail page.
 */
export function buildListIssue(
	webhook: Pick<WebhookSummary, "status" | "circuitOpenedAt" | "lastSuccessAt">,
): DoctorIssue | null {
	if (webhook.status !== "paused") return null;
	if (webhook.circuitOpenedAt) {
		return {
			code: "circuit",
			severity: "bad",
			evidence: [
				{
					label: "circuit opened",
					value: formatShortDate(webhook.circuitOpenedAt),
				},
				{
					label: "last success",
					value: webhook.lastSuccessAt
						? formatShortDate(webhook.lastSuccessAt)
						: "never",
				},
			],
			fix: {
				text: "Check your receiver's health and logs, then send a test event.",
				docsPath: "/docs/webhooks#receiver-down",
			},
		};
	}
	return { code: "paused", severity: "warn" };
}
