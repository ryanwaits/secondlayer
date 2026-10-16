import { type Kysely, sql } from "kysely";
import type { Database } from "../db/types.ts";
import type { InsightEvidence } from "../schemas/insights.ts";
import {
	handoffPrompt,
	hostOf,
	plainSnippet,
	plural,
	utcDateTime,
	utcTime,
} from "./prompt.ts";
import {
	DEAD_LETTER_DELETE_AGE_DAYS,
	DEAD_LETTER_WARN_AGE_DAYS,
	DOWN_MIN_CONSECUTIVE,
	LOGIN_WALL_MIN_CONSECUTIVE,
	LOGIN_WALL_MIN_PRIOR,
	LOGIN_WALL_PRIOR_JSON_RATIO,
	RATE_LIMITED_MIN_ATTEMPTS,
	RATE_LIMITED_MIN_RATIO,
	REJECTS_MIN_CONSECUTIVE,
	SLOWING_DAYS,
	SLOWING_MIN_R2,
	SLOWING_MIN_RISING_DAYS,
	TEST_ENDPOINT_MIN_AGE_DAYS,
	TLS_WARN_DAYS,
} from "./thresholds.ts";
import type { DetectedInsight, InsightRule } from "./types.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const BUCKET_MS = 10 * MINUTE_MS;
const BUCKETS = 36;
const SHAPE_BODY_MAX = 80;
const SHAPES_MAX = 4;
const ATTEMPT_WINDOW = 300;
const ATTEMPT_LOOKBACK_DAYS = 8;
const PRIOR_WINDOW_MS = 7 * DAY_MS;

// ── Inputs ─────────────────────────────────────────────────────────────

export interface DeliveryAttempt {
	outboxId: string | null;
	statusCode: number | null;
	durationMs: number | null;
	dispatchedAt: Date;
	errorMessage: string | null;
	/** First 200 characters of the receiver's response body. */
	body: string | null;
	contentType: string | null;
	server: string | null;
	retryAfter: string | null;
	blockHeight: number | null;
}

export interface WebhookRuleInput {
	now: Date;
	webhook: {
		id: string;
		name: string;
		status: string;
		url: string;
		triggers: unknown;
		timeoutMs: number;
		createdAt: Date;
		lastSuccessAt: Date | null;
		receiverCertExpiresAt: Date | null;
		receiverCertCheckedAt: Date | null;
	};
	/** Newest first, last 8 days, at most 300. */
	attempts: DeliveryAttempt[];
	/** Outbox rows still waiting to be delivered. */
	pending: number;
	/** 36 ten-minute buckets ending at `startMs + 36 * 10min`. */
	throughput: { startMs: number; matched: number[]; delivered: number[] };
	/** Last 14 UTC days, oldest first; null when no timed delivery that day. */
	dailyP95: { day: string; p95Ms: number | null }[];
	dead: {
		count: number;
		oldestAt: Date | null;
		oldestOutboxId: string | null;
	};
	deliveries30d: number;
	/** Other non-paused webhooks, for the duplicate check. */
	siblings: {
		id: string;
		name: string;
		url: string;
		triggers: unknown;
		createdAt: Date;
	}[];
	/**
	 * Function names by contract id, only for contracts whose ABI was fetched.
	 * `abiAvailable` is false when the lookup is off (no hosted read key) or
	 * failed, which makes `filter_cant_match` skip.
	 */
	abi: Record<string, string[]>;
	abiAvailable: boolean;
}

// ── Small helpers ──────────────────────────────────────────────────────

function consecutiveFromStart(
	rows: DeliveryAttempt[],
	predicate: (row: DeliveryAttempt) => boolean,
): DeliveryAttempt[] {
	const out: DeliveryAttempt[] = [];
	for (const row of rows) {
		if (!predicate(row)) break;
		out.push(row);
	}
	return out;
}

const is2xx = (d: DeliveryAttempt) =>
	d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 300;
const isDown = (d: DeliveryAttempt) =>
	d.statusCode === null || d.statusCode >= 500;
const isReject = (d: DeliveryAttempt) =>
	d.statusCode !== null &&
	d.statusCode >= 400 &&
	d.statusCode < 500 &&
	d.statusCode !== 429;
const isHtml = (d: DeliveryAttempt) =>
	(d.contentType ?? "").toLowerCase().startsWith("text/html");
const isJson = (d: DeliveryAttempt) =>
	(d.contentType ?? "").toLowerCase().startsWith("application/json");

function codeLabel(statusCode: number | null): string {
	return statusCode === null ? "no response" : String(statusCode);
}

function shapeText(d: DeliveryAttempt): string {
	return (d.body ?? d.errorMessage ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, SHAPE_BODY_MAX);
}

function shapeKey(d: DeliveryAttempt): string {
	return `${codeLabel(d.statusCode)}\u0000${shapeText(d)}`;
}

/** Distinct (status, body) shapes, most common first. `isNew` = not seen in
 *  the 7 days before these attempts. */
function buildShapes(
	affected: DeliveryAttempt[],
	earlier: DeliveryAttempt[],
	now: Date,
): Extract<InsightEvidence, { kind: "shapes" }>["shapes"] {
	const seenBefore = new Set(
		earlier
			.filter(
				(d) => now.getTime() - d.dispatchedAt.getTime() <= PRIOR_WINDOW_MS,
			)
			.map(shapeKey),
	);
	const counts = new Map<string, { sample: DeliveryAttempt; count: number }>();
	for (const d of affected) {
		const key = shapeKey(d);
		const entry = counts.get(key);
		if (entry) entry.count++;
		else counts.set(key, { sample: d, count: 1 });
	}
	return [...counts.entries()]
		.sort((a, b) => b[1].count - a[1].count)
		.slice(0, SHAPES_MAX)
		.map(([key, { sample, count }]) => ({
			code: codeLabel(sample.statusCode),
			body: shapeText(sample),
			count,
			isNew: !seenBefore.has(key),
		}));
}

function subject(name: string): string {
	return `My Secondlayer webhook "${name}"`;
}

function mostCommonCode(rows: DeliveryAttempt[]): number | null {
	const counts = new Map<number | null, number>();
	for (const r of rows)
		counts.set(r.statusCode, (counts.get(r.statusCode) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function breakdown(rows: DeliveryAttempt[]): string {
	const counts = new Map<string, number>();
	for (const r of rows) {
		const key = codeLabel(r.statusCode);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()].map(([k, n]) => `${n}x ${k}`).join(", ");
}

function attemptsLast24h(input: WebhookRuleInput): number {
	const since = input.now.getTime() - DAY_MS;
	return input.attempts.filter((a) => a.dispatchedAt.getTime() >= since).length;
}

function resourceOf(input: WebhookRuleInput) {
	return {
		kind: "webhook" as const,
		id: input.webhook.id,
		name: input.webhook.name,
	};
}

function throughputEvidence(
	input: WebhookRuleInput,
): Extract<InsightEvidence, { kind: "series" }> {
	const { startMs, matched, delivered } = input.throughput;
	const at = (i: number) =>
		utcTime(new Date(startMs + i * BUCKET_MS)).slice(0, 5);
	return {
		kind: "series",
		title: "Matched and delivered, every 10 minutes",
		series: [
			{ name: "Matched", role: "context", points: matched },
			{ name: "Delivered", role: "a", points: delivered },
		],
		labels: [
			[0, at(0)],
			[Math.floor(BUCKETS / 2), at(Math.floor(BUCKETS / 2))],
			[BUCKETS - 1, "now"],
		],
		unit: "events",
	};
}

function matchedPerHour(input: WebhookRuleInput): number {
	const total = input.throughput.matched.reduce((a, b) => a + b, 0);
	return Math.round(total / (BUCKETS / 6));
}

function levenshtein(a: string, b: string): number {
	const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let diagonal = prev[0] ?? 0;
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const above = prev[j] ?? 0;
			prev[j] = Math.min(
				above + 1,
				(prev[j - 1] ?? 0) + 1,
				diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			diagonal = above;
		}
	}
	return prev[b.length] ?? 0;
}

/** JSON with object keys sorted at every level, for equality checks. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

// ── Rules ──────────────────────────────────────────────────────────────

const receiverDown: InsightRule<WebhookRuleInput> = {
	id: "receiver_down",
	evaluate(input) {
		const streak = consecutiveFromStart(input.attempts, isDown);
		if (streak.length < DOWN_MIN_CONSECUTIVE) return null;

		const { webhook } = input;
		const since = streak[streak.length - 1]?.dispatchedAt ?? input.now;
		const host = hostOf(webhook.url);
		const code = mostCommonCode(streak);
		const server = streak.find((d) => d.server)?.server ?? null;
		const answer =
			code === null
				? "did not answer"
				: `returns HTTP ${code}${server ? ` from ${plainSnippet(server, 30)}` : ""}`;
		const hourly = matchedPerHour(input);
		const queued = input.pending;
		const flowing =
			hourly > 0
				? `Chain matches are normal (about ${hourly} an hour), so the problem is the receiver.`
				: "";

		const shapes = buildShapes(
			streak,
			input.attempts.slice(streak.length),
			input.now,
		);

		return {
			rule: "receiver_down",
			severity: "losing",
			impact: queued > 0 ? queued : streak.length,
			resource: resourceOf(input),
			line: `${webhook.name} has failed ${streak.length} deliveries in a row`,
			meta: `since ${utcTime(since)}`,
			lead: "Your receiver is down, not us.",
			body: [
				`${host} ${answer} on every delivery since ${utcTime(since)}.`,
				queued > 0 ? `${plural(queued, "delivery")} queued to retry.` : "",
				flowing,
			]
				.filter(Boolean)
				.join(" "),
			evidence: [
				throughputEvidence(input),
				{ kind: "shapes", title: "What the receiver sent back", shapes },
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`has been failing since ${utcTime(since)}`,
						`The receiver ${host} ${answer} on every delivery`,
						queued > 0 ? `${plural(queued, "delivery")} queued to retry` : "",
						flowing.replace(/\.$/, ""),
					],
					lookAt: `Check the service behind ${host}`,
					followUp: `Then run sl webhooks doctor ${webhook.name}`,
				}),
				commands: [
					`sl webhooks doctor ${webhook.name}`,
					`sl webhooks dead ${webhook.name}`,
				],
			},
			how: {
				detector: `the newest ${DOWN_MIN_CONSECUTIVE} or more delivery attempts are 5xx or got no response`,
				facts: [
					["consecutive failures", String(streak.length)],
					["breakdown", breakdown(streak)],
					["first failure", utcDateTime(since)],
					[
						"last success",
						webhook.lastSuccessAt
							? utcDateTime(webhook.lastSuccessAt)
							: "never",
					],
					["queued retries", String(queued)],
				],
			},
		};
	},
};

const receiverRejects: InsightRule<WebhookRuleInput> = {
	id: "receiver_rejects",
	evaluate(input) {
		const streak = consecutiveFromStart(input.attempts, isReject);
		if (streak.length < REJECTS_MIN_CONSECUTIVE) return null;

		const { webhook } = input;
		const host = hostOf(webhook.url);
		const code = mostCommonCode(streak);
		const since = streak[streak.length - 1]?.dispatchedAt ?? input.now;
		const text = plainSnippet(
			streak.find((d) => d.body || d.errorMessage)?.body ??
				streak.find((d) => d.errorMessage)?.errorMessage,
			100,
		);

		return {
			rule: "receiver_rejects",
			severity: "losing",
			impact: input.pending > 0 ? input.pending : streak.length,
			resource: resourceOf(input),
			line: `${webhook.name} is being rejected by ${host}`,
			meta: `${streak.length} in a row, HTTP ${code}`,
			lead: "Your receiver is refusing our requests.",
			body: [
				`${host} answered HTTP ${code} to the last ${streak.length} deliveries, since ${utcTime(since)}.`,
				text ? `It said: ${text}.` : "",
				"It is reachable, so this is usually its auth or signature check.",
			]
				.filter(Boolean)
				.join(" "),
			evidence: [
				{
					kind: "shapes",
					title: "What the receiver sent back",
					shapes: buildShapes(
						streak,
						input.attempts.slice(streak.length),
						input.now,
					),
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`has been rejected since ${utcTime(since)}`,
						`The receiver ${host} answered HTTP ${code} to ${plural(streak.length, "delivery")} in a row`,
						text ? `The response said: ${text}` : "",
					],
					lookAt: `Check how ${host} authenticates or verifies signatures on incoming webhook requests`,
					followUp: `Then run sl webhooks test ${webhook.name}`,
				}),
				commands: [`sl webhooks test ${webhook.name}`],
			},
			how: {
				detector: `the newest ${REJECTS_MIN_CONSECUTIVE} or more delivery attempts are 4xx other than 429`,
				facts: [
					["consecutive rejects", String(streak.length)],
					["breakdown", breakdown(streak)],
					["first reject", utcDateTime(since)],
				],
			},
		};
	},
};

const receiverRateLimited: InsightRule<WebhookRuleInput> = {
	id: "receiver_rate_limited",
	evaluate(input) {
		const window = input.attempts.slice(0, 100);
		if (window.length < RATE_LIMITED_MIN_ATTEMPTS) return null;
		const limited = window.filter((d) => d.statusCode === 429);
		if (limited.length / window.length < RATE_LIMITED_MIN_RATIO) return null;

		const { webhook } = input;
		const host = hostOf(webhook.url);
		const retryAfter =
			limited.find((d) => d.retryAfter && /^\d+$/.test(d.retryAfter))
				?.retryAfter ?? null;
		const percent = Math.round((limited.length / window.length) * 100);

		return {
			rule: "receiver_rate_limited",
			severity: "will_fail",
			impact: limited.length,
			resource: resourceOf(input),
			line: `${host} is rate limiting ${webhook.name}`,
			meta: `${limited.length} of the last ${window.length} attempts`,
			lead: "Your receiver is telling us to slow down.",
			body: [
				`${percent}% of recent deliveries got HTTP 429.`,
				retryAfter ? `It asked us to wait ${retryAfter} seconds.` : "",
				"We retry, so nothing is lost yet, but a long streak ends in dead letters.",
			]
				.filter(Boolean)
				.join(" "),
			evidence: [
				{
					kind: "shapes",
					title: "What the receiver sent back",
					shapes: buildShapes(
						window,
						input.attempts.slice(window.length),
						input.now,
					),
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`is being rate limited by ${host}`,
						`${limited.length} of the last ${window.length} delivery attempts got HTTP 429`,
						retryAfter
							? `The receiver asked for ${retryAfter} seconds between retries`
							: "",
					],
					lookAt: `Check the rate limit on ${host} and whether this webhook should have its own allowance`,
					followUp: `Then run sl webhooks deliveries ${webhook.name}`,
				}),
				commands: [`sl webhooks deliveries ${webhook.name}`],
			},
			how: {
				detector: `at least ${RATE_LIMITED_MIN_ATTEMPTS} recent attempts and ${Math.round(RATE_LIMITED_MIN_RATIO * 100)}% or more are HTTP 429`,
				facts: [
					["429 responses", `${limited.length} of ${window.length}`],
					["latest Retry-After", retryAfter ? `${retryAfter}s` : "not sent"],
				],
			},
		};
	},
};

const receiverLoginWall: InsightRule<WebhookRuleInput> = {
	id: "receiver_login_wall",
	evaluate(input) {
		const streak = consecutiveFromStart(
			input.attempts,
			(d) => is2xx(d) && isHtml(d),
		);
		if (streak.length < LOGIN_WALL_MIN_CONSECUTIVE) return null;

		const start = streak[streak.length - 1]?.dispatchedAt ?? input.now;
		const prior = input.attempts
			.slice(streak.length)
			.filter(
				(d) =>
					is2xx(d) &&
					start.getTime() - d.dispatchedAt.getTime() <= PRIOR_WINDOW_MS,
			);
		if (prior.length < LOGIN_WALL_MIN_PRIOR) return null;
		const json = prior.filter(isJson);
		if (json.length / prior.length < LOGIN_WALL_PRIOR_JSON_RATIO) return null;

		const { webhook } = input;
		const host = hostOf(webhook.url);
		const heights = streak
			.map((d) => d.blockHeight)
			.filter((h): h is number => h !== null);
		const from = heights.length > 0 ? Math.min(...heights) : null;
		const to = heights.length > 0 ? Math.max(...heights) : null;
		const htmlSample = streak.find((d) => d.body);
		const jsonSample = json.find((d) => d.body);

		return {
			rule: "receiver_login_wall",
			severity: "losing",
			impact: streak.length,
			resource: resourceOf(input),
			line: `${host} now answers ${webhook.name} with a web page`,
			meta: `${streak.length} deliveries since ${utcTime(start)}`,
			lead: "Your receiver says OK, but sends back a web page.",
			body: [
				`Since ${utcTime(start)} every delivery got HTTP 200 with an HTML page instead of JSON.`,
				"That is usually a login page or proxy screen in front of the endpoint, so the events are not reaching your handler.",
			].join(" "),
			evidence: [
				{
					kind: "shapes",
					title: "Response before and after",
					shapes: [
						{
							code: "200",
							body: jsonSample ? shapeText(jsonSample) : "application/json",
							count: json.length,
							isNew: false,
						},
						{
							code: "200",
							body: htmlSample ? shapeText(htmlSample) : "text/html",
							count: streak.length,
							isNew: true,
						},
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`has been answered with a web page since ${utcTime(start)}`,
						`${host} returns HTTP 200 with text/html on ${streak.length} deliveries in a row, where it used to return JSON`,
						`${json.length} of ${prior.length} successful deliveries in the week before were JSON`,
					],
					lookAt: `Check whether a login page, access policy or proxy rule was put in front of ${host}`,
					followUp:
						from !== null && to !== null
							? `Once it is fixed, replay the missed blocks with sl webhooks replay ${webhook.name} --from-block ${from} --to-block ${to} -y`
							: undefined,
				}),
				commands:
					from !== null && to !== null
						? [
								`sl webhooks replay ${webhook.name} --from-block ${from} --to-block ${to} -y`,
							]
						: [],
			},
			how: {
				detector: `the newest ${LOGIN_WALL_MIN_CONSECUTIVE} or more successful responses are text/html while ${Math.round(LOGIN_WALL_PRIOR_JSON_RATIO * 100)}% or more of the week before were JSON`,
				facts: [
					["html responses in a row", String(streak.length)],
					["first html response", utcDateTime(start)],
					["json share before", `${json.length} of ${prior.length}`],
					...(from !== null && to !== null
						? ([["affected blocks", `${from} to ${to}`]] as [string, string][])
						: []),
				],
			},
		};
	},
};

/** Least-squares line through (x, y). */
function fitLine(points: { x: number; y: number }[]) {
	const n = points.length;
	const meanX = points.reduce((s, p) => s + p.x, 0) / n;
	const meanY = points.reduce((s, p) => s + p.y, 0) / n;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (const p of points) {
		sxx += (p.x - meanX) ** 2;
		sxy += (p.x - meanX) * (p.y - meanY);
		syy += (p.y - meanY) ** 2;
	}
	const slope = sxx === 0 ? 0 : sxy / sxx;
	const intercept = meanY - slope * meanX;
	const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
	return { slope, intercept, r2 };
}

const receiverSlowing: InsightRule<WebhookRuleInput> = {
	id: "receiver_slowing",
	evaluate(input) {
		const days = input.dailyP95;
		if (days.length < SLOWING_DAYS) return null;

		let rising = 0;
		for (let i = 1; i < days.length; i++) {
			const prev = days[i - 1]?.p95Ms;
			const cur = days[i]?.p95Ms;
			if (prev != null && cur != null && cur > prev) rising++;
		}
		if (rising < SLOWING_MIN_RISING_DAYS) return null;

		const points = days.flatMap((d, x) =>
			d.p95Ms === null ? [] : [{ x, y: d.p95Ms }],
		);
		if (points.length < SLOWING_MIN_RISING_DAYS) return null;
		const fit = fitLine(points);
		if (fit.slope <= 0 || fit.r2 < SLOWING_MIN_R2) return null;

		const timeout = input.webhook.timeoutMs;
		const lastX = days.length - 1;
		const nowFit = fit.intercept + fit.slope * lastX;
		const laterFit = fit.intercept + fit.slope * (lastX + SLOWING_DAYS);
		if (!(nowFit < timeout && laterFit >= timeout)) return null;

		const daysLeft = Math.max(1, Math.round((timeout - nowFit) / fit.slope));
		const { webhook } = input;
		const host = hostOf(webhook.url);
		const first = days.find((d) => d.p95Ms !== null)?.p95Ms ?? 0;
		const last = [...days].reverse().find((d) => d.p95Ms !== null)?.p95Ms ?? 0;

		return {
			rule: "receiver_slowing",
			severity: "will_fail",
			impact: attemptsLast24h(input),
			resource: resourceOf(input),
			line: `${host} is getting slower for ${webhook.name}`,
			meta: `may hit the ${timeout / 1000}s timeout in about ${plural(daysLeft, "day")}`,
			lead: "Your receiver is slowing down, and not by chance.",
			body: `The slowest 5% of deliveries went from ${Math.round(first)} ms to ${Math.round(last)} ms over ${days.length} days, rising on ${rising} of them. At this pace they reach the ${timeout} ms timeout in about ${plural(daysLeft, "day")}, and then they start failing.`,
			evidence: [
				{
					kind: "series",
					title: "Slowest 5% of response times, per day",
					series: [
						{
							name: "p95",
							role: "a",
							points: days.map((d) => Math.round(d.p95Ms ?? 0)),
						},
						{
							name: "Timeout",
							role: "context",
							points: days.map(() => timeout),
						},
					],
					labels: [
						[0, days[0]?.day.slice(5) ?? ""],
						[lastX, days[lastX]?.day.slice(5) ?? ""],
					],
					unit: "ms",
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`is getting slower: its receiver ${host} took ${Math.round(first)} ms at the slow end ${days.length} days ago and ${Math.round(last)} ms now`,
						`The delivery timeout is ${timeout} ms, which the trend reaches in about ${plural(daysLeft, "day")}`,
					],
					lookAt: `Check what changed on ${host} over the last two weeks, such as data growth, a slower dependency or a heavier handler`,
					followUp: `Then run sl webhooks deliveries ${webhook.name}`,
				}),
				commands: [`sl webhooks deliveries ${webhook.name}`],
			},
			how: {
				detector: `daily p95 response time rose on ${SLOWING_MIN_RISING_DAYS} or more of ${SLOWING_DAYS} days, a straight-line fit has r2 of ${SLOWING_MIN_R2} or more, and it reaches the timeout within ${SLOWING_DAYS} days`,
				facts: [
					["rising days", `${rising} of ${days.length}`],
					["trend", `+${Math.round(fit.slope)} ms a day`],
					["fit r2", fit.r2.toFixed(2)],
					["timeout", `${timeout} ms`],
					["days until timeout", String(daysLeft)],
				],
			},
		};
	},
};

const tlsExpiring: InsightRule<WebhookRuleInput> = {
	id: "tls_expiring",
	evaluate(input) {
		const expires = input.webhook.receiverCertExpiresAt;
		if (!expires) return null;
		const msLeft = expires.getTime() - input.now.getTime();
		if (msLeft >= TLS_WARN_DAYS * DAY_MS) return null;

		const { webhook } = input;
		const host = hostOf(webhook.url);
		const daysLeft = Math.floor(msLeft / DAY_MS);
		const expired = msLeft <= 0;

		return {
			rule: "tls_expiring",
			severity: "will_fail",
			impact: attemptsLast24h(input),
			resource: resourceOf(input),
			line: expired
				? `The certificate for ${host} has expired`
				: `The certificate for ${host} expires soon`,
			meta: expired
				? `expired ${utcDateTime(expires)}`
				: `in ${plural(daysLeft, "day")}`,
			lead: expired
				? "Your receiver's certificate has expired."
				: "Your receiver's certificate is about to expire.",
			body: expired
				? `Deliveries to ${host} fail the TLS check until the certificate is renewed.`
				: `After ${utcDateTime(expires)} deliveries to ${host} fail the TLS check until the certificate is renewed.`,
			evidence: [
				{
					kind: "table",
					title: "Receiver certificate",
					columns: ["Host", "Expires", "Days left", "Last checked"],
					rows: [
						[
							host,
							utcDateTime(expires),
							daysLeft,
							input.webhook.receiverCertCheckedAt
								? utcDateTime(input.webhook.receiverCertCheckedAt)
								: "unknown",
						],
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						expired
							? `points at ${host}, whose TLS certificate expired on ${utcDateTime(expires)}`
							: `points at ${host}, whose TLS certificate expires on ${utcDateTime(expires)}`,
					],
					lookAt: `Check why the certificate on ${host} is not renewing automatically`,
				}),
				commands: [],
			},
			how: {
				detector: `the receiver certificate expires in less than ${TLS_WARN_DAYS} days`,
				facts: [
					["expires", utcDateTime(expires)],
					["days left", String(daysLeft)],
				],
			},
		};
	},
};

interface ContractCallTrigger {
	contractId: string;
	functionName: string;
}

function literalContractCalls(triggers: unknown): ContractCallTrigger[] {
	if (!Array.isArray(triggers)) return [];
	const out: ContractCallTrigger[] = [];
	for (const t of triggers) {
		if (!t || typeof t !== "object") continue;
		const { type, contractId, functionName } = t as Record<string, unknown>;
		if (type !== "contract_call") continue;
		if (typeof contractId !== "string" || typeof functionName !== "string")
			continue;
		if (contractId.includes("*") || functionName.includes("*")) continue;
		out.push({ contractId, functionName });
	}
	return out;
}

/** Contract ids whose ABI the loader must fetch for this webhook. */
export function contractIdsToCheck(triggers: unknown): string[] {
	return [...new Set(literalContractCalls(triggers).map((t) => t.contractId))];
}

const filterCantMatch: InsightRule<WebhookRuleInput> = {
	id: "filter_cant_match",
	skip: (input) =>
		contractIdsToCheck(input.webhook.triggers).length > 0 &&
		!input.abiAvailable,
	evaluate(input) {
		const offending = literalContractCalls(input.webhook.triggers).filter(
			(t) => {
				const names = input.abi[t.contractId];
				return names !== undefined && !names.includes(t.functionName);
			},
		);
		const first = offending[0];
		if (!first) return null;

		const names = input.abi[first.contractId] ?? [];
		const ranked = [...names].sort(
			(a, b) =>
				levenshtein(a, first.functionName) - levenshtein(b, first.functionName),
		);
		const closest = ranked[0];
		const { webhook } = input;

		return {
			rule: "filter_cant_match",
			severity: "will_fail",
			impact: offending.length,
			resource: resourceOf(input),
			line: `${webhook.name} can never match a call`,
			meta: `${first.contractId} has no ${first.functionName}`,
			lead: "This filter waits for something that does not exist.",
			body: [
				`${first.contractId} has no public function named ${first.functionName}, so no event will ever match.`,
				closest ? `The closest is ${closest}.` : "",
			]
				.filter(Boolean)
				.join(" "),
			evidence: [
				{
					kind: "table",
					title: "Public functions on the contract",
					columns: ["Function", "In contract"],
					rows: [
						[first.functionName, "not found"],
						...ranked.slice(0, 6).map((n): [string, string] => [n, "yes"]),
					],
					markRow: 0,
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`waits for calls to ${first.functionName} on ${first.contractId}`,
						`That contract has no public method with that name${closest ? `, and the closest name is ${closest}` : ""}`,
						"The webhook has never matched and cannot",
					],
					lookAt:
						"Check the spelling in the trigger and whether the contract was redeployed under another name",
					followUp: `Create the corrected webhook first, then run sl webhooks delete ${webhook.name}`,
				}),
				commands: [`sl webhooks delete ${webhook.name}`],
			},
			how: {
				detector:
					"a contract_call trigger names a literal contract and method, the contract exists, and its ABI has no method with that name",
				facts: [
					["contract", first.contractId],
					["method in trigger", first.functionName],
					["methods on contract", String(names.length)],
					["triggers that cannot match", String(offending.length)],
				],
			},
		};
	},
};

const deadLettersExpiring: InsightRule<WebhookRuleInput> = {
	id: "dead_letters_expiring",
	evaluate(input) {
		const { dead, webhook } = input;
		if (dead.count === 0 || !dead.oldestAt) return null;

		const deleteAt = new Date(
			dead.oldestAt.getTime() + DEAD_LETTER_DELETE_AGE_DAYS * DAY_MS,
		);
		return {
			rule: "dead_letters_expiring",
			severity: "will_fail",
			impact: dead.count,
			resource: resourceOf(input),
			line: `${plural(dead.count, "failed event")} on ${webhook.name} will be deleted`,
			meta: `from ${utcDateTime(deleteAt)}`,
			lead: "Failed events are kept for 90 days, and these are almost there.",
			body: `${plural(dead.count, "event")} that never reached your receiver are older than ${DEAD_LETTER_WARN_AGE_DAYS} days. The oldest is deleted on ${utcDateTime(deleteAt)}. Send them again before then if you still want them.`,
			evidence: [
				{
					kind: "table",
					title: "Failed events near deletion",
					columns: ["Failed events", "Oldest failure", "Deleted from"],
					rows: [
						[dead.count, utcDateTime(dead.oldestAt), utcDateTime(deleteAt)],
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`has ${plural(dead.count, "failed event")} older than ${DEAD_LETTER_WARN_AGE_DAYS} days`,
						`The oldest failed on ${utcDateTime(dead.oldestAt)} and is deleted from ${utcDateTime(deleteAt)}`,
					],
					lookAt:
						"Decide whether those events still matter, and confirm the receiver can handle them now",
					followUp: `Then run sl webhooks dead ${webhook.name}${dead.oldestOutboxId ? ` and sl webhooks requeue ${webhook.name} ${dead.oldestOutboxId}` : ""}`,
				}),
				commands: [
					`sl webhooks dead ${webhook.name}`,
					...(dead.oldestOutboxId
						? [`sl webhooks requeue ${webhook.name} ${dead.oldestOutboxId}`]
						: []),
				],
			},
			how: {
				detector: `failed outbox rows older than ${DEAD_LETTER_WARN_AGE_DAYS} days exist (deleted at ${DEAD_LETTER_DELETE_AGE_DAYS})`,
				facts: [
					["failed events past the line", String(dead.count)],
					["oldest failure", utcDateTime(dead.oldestAt)],
					["oldest is deleted", utcDateTime(deleteAt)],
				],
			},
		};
	},
};

const duplicateWebhook: InsightRule<WebhookRuleInput> = {
	id: "duplicate_webhook",
	evaluate(input) {
		const { webhook, siblings } = input;
		const mine = canonicalJson(webhook.triggers);
		const twin = siblings.find(
			(s) => s.url === webhook.url && canonicalJson(s.triggers) === mine,
		);
		if (!twin) return null;
		// One card, on the newer webhook (ties broken by id).
		const newer =
			webhook.createdAt.getTime() !== twin.createdAt.getTime()
				? webhook.createdAt.getTime() > twin.createdAt.getTime()
				: webhook.id > twin.id;
		if (!newer) return null;

		return {
			rule: "duplicate_webhook",
			severity: "costs",
			impact: input.deliveries30d,
			resource: resourceOf(input),
			line: `${webhook.name} duplicates ${twin.name}`,
			meta: "same URL and same filters",
			lead: "Two webhooks do the same job.",
			body: `${webhook.name} and ${twin.name} send the same events to ${hostOf(webhook.url)}. Your receiver gets each event twice, and each delivery counts.`,
			evidence: [
				{
					kind: "table",
					title: "Matching webhooks",
					columns: ["Webhook", "Created"],
					rows: [
						[twin.name, utcDateTime(twin.createdAt)],
						[webhook.name, utcDateTime(webhook.createdAt)],
					],
					markRow: 1,
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`duplicates the webhook "${twin.name}"`,
						`Both send the same filters to ${webhook.url}, so each event is delivered twice`,
					],
					lookAt: `Check that nothing relies on both, then remove the newer one, ${webhook.name}`,
				}),
				commands: [`sl webhooks delete ${webhook.name}`],
			},
			how: {
				detector: "two non-paused webhooks share a URL and identical triggers",
				facts: [
					["older webhook", twin.name],
					["newer webhook", webhook.name],
					["deliveries in the last 30 days", String(input.deliveries30d)],
				],
			},
		};
	},
};

const TEST_HOST_SUFFIXES = [".ngrok.io", ".ngrok-free.app", ".pipedream.net"];
const TEST_HOSTS = new Set(["postman-echo.com", "webhook.site"]);

/** True for well-known throwaway receiver hosts. */
export function isTestHost(host: string): boolean {
	const name = host.toLowerCase().split(":")[0] ?? "";
	return (
		TEST_HOSTS.has(name) ||
		name.startsWith("requestbin.") ||
		TEST_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix))
	);
}

const testEndpoint: InsightRule<WebhookRuleInput> = {
	id: "test_endpoint",
	evaluate(input) {
		const { webhook } = input;
		const host = hostOf(webhook.url);
		if (!isTestHost(host)) return null;
		const ageMs = input.now.getTime() - webhook.createdAt.getTime();
		if (ageMs <= TEST_ENDPOINT_MIN_AGE_DAYS * DAY_MS) return null;

		const ageDays = Math.floor(ageMs / DAY_MS);
		return {
			rule: "test_endpoint",
			severity: "costs",
			impact: input.deliveries30d,
			resource: resourceOf(input),
			line: `${webhook.name} still sends to a test endpoint`,
			meta: host,
			lead: "This webhook points at a throwaway test URL.",
			body: `${host} is a public testing service, and ${webhook.name} has been sending to it for ${plural(ageDays, "day")}. Real events are leaving your account, and each delivery counts.`,
			evidence: [
				{
					kind: "table",
					title: "Test endpoint",
					columns: ["Host", "Age", "Deliveries, last 30 days"],
					rows: [[host, `${ageDays} days`, input.deliveries30d]],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(webhook.name),
					observed: [
						`has sent to the test service ${host} for ${plural(ageDays, "day")}`,
						`${plural(input.deliveries30d, "delivery")} in the last 30 days`,
					],
					lookAt:
						"Decide whether this should point at a real receiver, or be paused or removed",
				}),
				commands: [
					`sl webhooks pause ${webhook.name}`,
					`sl webhooks delete ${webhook.name}`,
				],
			},
			how: {
				detector: `the receiver host is a known test service and the webhook is older than ${TEST_ENDPOINT_MIN_AGE_DAYS} days`,
				facts: [
					["host", host],
					["age", `${ageDays} days`],
					["deliveries in the last 30 days", String(input.deliveries30d)],
				],
			},
		};
	},
};

export const WEBHOOK_RULES: InsightRule<WebhookRuleInput>[] = [
	receiverDown,
	receiverRejects,
	receiverRateLimited,
	receiverLoginWall,
	receiverSlowing,
	tlsExpiring,
	filterCantMatch,
	deadLettersExpiring,
	duplicateWebhook,
	testEndpoint,
];

export type { DetectedInsight };

// ── ABI lookup ─────────────────────────────────────────────────────────

const ABI_TTL_MS = 24 * 3600_000;

export interface AbiCache {
	get(contractId: string, now: number): string[] | undefined;
	set(contractId: string, names: string[], now: number): void;
}

export function createAbiCache(): AbiCache {
	const entries = new Map<string, { names: string[]; at: number }>();
	return {
		get(contractId, now) {
			const hit = entries.get(contractId);
			return hit && now - hit.at < ABI_TTL_MS ? hit.names : undefined;
		},
		set(contractId, names, now) {
			entries.set(contractId, { names, at: now });
		},
	};
}

export interface AbiDeps {
	env: Record<string, string | undefined>;
	fetchImpl: typeof fetch;
	cache: AbiCache;
}

/**
 * Public function names for one contract from the hosted read API. Returns
 * `"unavailable"` on any error (the rule then skips: never fire on missing
 * data), and `null` when the contract is not in the registry.
 */
async function fetchFunctionNames(
	contractId: string,
	baseUrl: string,
	apiKey: string,
	deps: AbiDeps,
): Promise<string[] | null | "unavailable"> {
	try {
		const res = await deps.fetchImpl(
			`${baseUrl.replace(/\/$/, "")}/v1/contracts/${encodeURIComponent(contractId)}?include=abi`,
			{
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(5000),
			},
		);
		if (res.status === 404) return null;
		if (!res.ok) return "unavailable";
		const body = (await res.json()) as {
			contract?: { abi?: { functions?: { name?: unknown }[] } | null };
		};
		const functions = body.contract?.abi?.functions;
		if (!Array.isArray(functions)) return "unavailable";
		return functions
			.map((f) => f.name)
			.filter((n): n is string => typeof n === "string");
	} catch {
		return "unavailable";
	}
}

// ── Loader ─────────────────────────────────────────────────────────────

type Num = string | number | null;
const num = (v: Num): number | null => (v === null ? null : Number(v));

/** Everything the webhook rules read, in a handful of queries for all webhooks. */
export async function loadWebhookInputs(
	db: Kysely<Database>,
	now: Date,
	abiDeps: AbiDeps,
): Promise<WebhookRuleInput[]> {
	const nowMs = now.getTime();
	const webhooks = await db
		.selectFrom("webhooks")
		.select([
			"id",
			"name",
			"status",
			"url",
			"triggers",
			"timeout_ms",
			"created_at",
			"last_success_at",
			"receiver_cert_expires_at",
			"receiver_cert_checked_at",
		])
		.execute();
	if (webhooks.length === 0) return [];

	const lookback = new Date(nowMs - ATTEMPT_LOOKBACK_DAYS * DAY_MS);
	const attemptRows = await sql<{
		webhook_id: string;
		outbox_id: string | null;
		status_code: number | null;
		duration_ms: number | null;
		dispatched_at: Date;
		error_message: string | null;
		body: string | null;
		content_type: string | null;
		server: string | null;
		retry_after: string | null;
		block_height: Num;
	}>`
		SELECT webhook_id, outbox_id, status_code, duration_ms, dispatched_at,
			error_message, body, content_type, server, retry_after, block_height
		FROM (
			SELECT d.webhook_id, d.outbox_id, d.status_code, d.duration_ms,
				d.dispatched_at, d.error_message,
				left(d.response_body, 200) AS body,
				d.response_headers ->> 'content-type' AS content_type,
				d.response_headers ->> 'server' AS server,
				d.response_headers ->> 'retry-after' AS retry_after,
				o.block_height,
				row_number() OVER (PARTITION BY d.webhook_id ORDER BY d.dispatched_at DESC) AS rn
			FROM webhook_deliveries d
			LEFT JOIN webhook_outbox o ON o.id = d.outbox_id
			WHERE d.dispatched_at > ${lookback}
		) t
		WHERE rn <= ${ATTEMPT_WINDOW}
		ORDER BY webhook_id, dispatched_at DESC
	`.execute(db);

	const startMs =
		Math.floor(nowMs / BUCKET_MS) * BUCKET_MS - (BUCKETS - 1) * BUCKET_MS;
	const start = new Date(startMs);
	const matchedRows = await sql<{ webhook_id: string; b: number; n: Num }>`
		SELECT webhook_id,
			floor(extract(epoch FROM (created_at - ${start}::timestamptz)) / 600)::int AS b,
			count(*) AS n
		FROM webhook_outbox
		WHERE created_at >= ${start} AND is_replay = false
		GROUP BY 1, 2
	`.execute(db);
	const deliveredRows = await sql<{ webhook_id: string; b: number; n: Num }>`
		SELECT webhook_id,
			floor(extract(epoch FROM (delivered_at - ${start}::timestamptz)) / 600)::int AS b,
			count(*) AS n
		FROM webhook_outbox
		WHERE delivered_at >= ${start} AND status = 'delivered'
		GROUP BY 1, 2
	`.execute(db);
	const pendingRows = await sql<{ webhook_id: string; n: Num }>`
		SELECT webhook_id, count(*) AS n FROM webhook_outbox
		WHERE status = 'pending' GROUP BY 1
	`.execute(db);

	const dayStart =
		Math.floor(nowMs / DAY_MS) * DAY_MS - (SLOWING_DAYS - 1) * DAY_MS;
	const p95Rows = await sql<{ webhook_id: string; day: string; p95: Num }>`
		SELECT webhook_id,
			to_char(dispatched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
			percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
		FROM webhook_deliveries
		WHERE dispatched_at >= ${new Date(dayStart)} AND duration_ms IS NOT NULL
		GROUP BY 1, 2
	`.execute(db);

	const warnBefore = new Date(nowMs - DEAD_LETTER_WARN_AGE_DAYS * DAY_MS);
	const deadRows = await sql<{
		webhook_id: string;
		n: Num;
		oldest: Date;
		oldest_id: string;
	}>`
		SELECT webhook_id, count(*) AS n,
			min(coalesce(failed_at, created_at)) AS oldest,
			(array_agg(id ORDER BY coalesce(failed_at, created_at)))[1] AS oldest_id
		FROM webhook_outbox
		WHERE status = 'dead' AND coalesce(failed_at, created_at) < ${warnBefore}
		GROUP BY 1
	`.execute(db);
	const deliveryCountRows = await sql<{ webhook_id: string; n: Num }>`
		SELECT webhook_id, count(*) AS n FROM webhook_deliveries
		WHERE dispatched_at > ${new Date(nowMs - 30 * DAY_MS)} GROUP BY 1
	`.execute(db);

	const attemptsBy = new Map<string, DeliveryAttempt[]>();
	for (const r of attemptRows.rows) {
		const list = attemptsBy.get(r.webhook_id) ?? [];
		list.push({
			outboxId: r.outbox_id,
			statusCode: r.status_code,
			durationMs: r.duration_ms,
			dispatchedAt: r.dispatched_at,
			errorMessage: r.error_message,
			body: r.body,
			contentType: r.content_type,
			server: r.server,
			retryAfter: r.retry_after,
			blockHeight: num(r.block_height),
		});
		attemptsBy.set(r.webhook_id, list);
	}
	const series = (rows: { webhook_id: string; b: number; n: Num }[]) => {
		const by = new Map<string, number[]>();
		for (const r of rows) {
			if (r.b < 0 || r.b >= BUCKETS) continue;
			const arr = by.get(r.webhook_id) ?? new Array<number>(BUCKETS).fill(0);
			arr[r.b] = Number(r.n);
			by.set(r.webhook_id, arr);
		}
		return by;
	};
	const matchedBy = series(matchedRows.rows);
	const deliveredBy = series(deliveredRows.rows);
	const pendingBy = new Map(
		pendingRows.rows.map((r) => [r.webhook_id, Number(r.n)]),
	);
	const countBy = new Map(
		deliveryCountRows.rows.map((r) => [r.webhook_id, Number(r.n)]),
	);
	const deadBy = new Map(deadRows.rows.map((r) => [r.webhook_id, r]));
	const p95By = new Map<string, Map<string, number>>();
	for (const r of p95Rows.rows) {
		const m = p95By.get(r.webhook_id) ?? new Map<string, number>();
		m.set(r.day, Number(r.p95));
		p95By.set(r.webhook_id, m);
	}
	const days = Array.from({ length: SLOWING_DAYS }, (_, i) =>
		new Date(dayStart + i * DAY_MS).toISOString().slice(0, 10),
	);

	// ABI lookups: only literal contract_call triggers, only when a hosted
	// read key and URL exist. Cached 24h per contract.
	const baseUrl = abiDeps.env.STREAMS_API_URL?.trim();
	const apiKey = abiDeps.env.INDEX_INTERNAL_API_KEY?.trim();
	const abiEnabled = Boolean(baseUrl && apiKey);
	const abiBy = new Map<string, string[] | null | "unavailable">();
	if (abiEnabled && baseUrl && apiKey) {
		const wanted = new Set(
			webhooks
				.filter((w) => w.status !== "paused")
				.flatMap((w) => contractIdsToCheck(w.triggers)),
		);
		for (const id of wanted) {
			const cached = abiDeps.cache.get(id, nowMs);
			if (cached) {
				abiBy.set(id, cached);
				continue;
			}
			const names = await fetchFunctionNames(id, baseUrl, apiKey, abiDeps);
			if (Array.isArray(names)) abiDeps.cache.set(id, names, nowMs);
			abiBy.set(id, names);
		}
	}

	const live = webhooks.filter((w) => w.status !== "paused");
	return webhooks.map((w) => {
		const dead = deadBy.get(w.id);
		const ids = contractIdsToCheck(w.triggers);
		const abi: Record<string, string[]> = {};
		let abiAvailable = abiEnabled;
		for (const id of ids) {
			const found = abiBy.get(id);
			if (Array.isArray(found)) abi[id] = found;
			else if (found === "unavailable") abiAvailable = false;
		}
		const p95 = p95By.get(w.id);
		return {
			now,
			webhook: {
				id: w.id,
				name: w.name,
				status: w.status,
				url: w.url,
				triggers: w.triggers,
				timeoutMs: w.timeout_ms,
				createdAt: w.created_at,
				lastSuccessAt: w.last_success_at,
				receiverCertExpiresAt: w.receiver_cert_expires_at,
				receiverCertCheckedAt: w.receiver_cert_checked_at,
			},
			attempts: attemptsBy.get(w.id) ?? [],
			pending: pendingBy.get(w.id) ?? 0,
			throughput: {
				startMs,
				matched: matchedBy.get(w.id) ?? new Array<number>(BUCKETS).fill(0),
				delivered: deliveredBy.get(w.id) ?? new Array<number>(BUCKETS).fill(0),
			},
			dailyP95: days.map((day) => ({ day, p95Ms: p95?.get(day) ?? null })),
			dead: {
				count: dead ? Number(dead.n) : 0,
				oldestAt: dead?.oldest ?? null,
				oldestOutboxId: dead?.oldest_id ?? null,
			},
			deliveries30d: countBy.get(w.id) ?? 0,
			siblings: live
				.filter((o) => o.id !== w.id)
				.map((o) => ({
					id: o.id,
					name: o.name,
					url: o.url,
					triggers: o.triggers,
					createdAt: o.created_at,
				})),
			abi,
			abiAvailable,
		};
	});
}
