import { runwayDays } from "@secondlayer/platform/billing/runway";
import {
	BACKFILL_DAY_SHARE,
	BACKFILL_FULL_PAGE_RATIO,
	BACKFILL_MIN_DAY_ROWS,
	CREDITS_RUNWAY_WARN_DAYS,
	DUPLICATE_READS_LOOKBACK_MS,
	DUPLICATE_READS_MIN_PAGES,
	DUPLICATE_READS_WINDOW_MS,
	type DetectedInsight,
	type InsightRule,
	KEY_UNUSED_DAYS,
	PAGE_CAP_ROWS,
	POLLING_FOLLOW_GAP_MS,
	POLLING_LOOKBACK_MS,
	POLLING_MAX_STDDEV_RATIO,
	POLLING_MIN_DURATION_MS,
	POLLING_MIN_EMPTY_RATIO,
	POLLING_MIN_REQUESTS,
	POLLING_STALE_INTERVALS,
	REVOKED_KEY_ACTIVE_MS,
	SERVER_ERRORS_MIN_5XX,
	handoffPrompt,
	plural,
	utcDateTime,
	utcDay,
	utcTime,
} from "@secondlayer/shared/insights";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const USD_MICROS_PER_CENT = 10_000n;

// ── Inputs ─────────────────────────────────────────────────────────────

export interface RequestLogRow {
	apiKeyId: string | null;
	pathTemplate: string;
	paramsHash: string | null;
	cursorHash: string | null;
	pageSize: number | null;
	/** NULL means no rows were served; treated as 0. */
	rows: number | null;
	status: number;
	createdAt: Date;
}

export interface AccountRuleInput {
	now: Date;
	/** Index and Streams reads from the last 24 hours, oldest first. */
	requests: RequestLogRow[];
	/** 5xx answers recorded for this account in the last hour. */
	failed5xx: { path: string; status: number; createdAt: Date }[];
	/** The month's first paid `rows.delivered` row, and what followed. */
	allowance: {
		firstPaidAt: Date | null;
		paidRows: number;
		paidUsdMicros: bigint;
	};
	/** This month's `rows.delivered` quantity. */
	monthRows: number;
	/** This month, one entry per UTC day with `rows.delivered` ledger rows. */
	rowsByDay: {
		day: string;
		rows: number;
		pages: number;
		fullPages: number;
		usdMicros: bigint;
	}[];
	cap: {
		monthlyCapCents: number | null;
		/** This month's prepaid-credit spend (what the cap is compared to). */
		spentMonthUsdMicros: bigint;
		/** Positive ledger charges in the last 7 days. */
		last7dChargesUsdMicros: bigint;
	};
	balanceUsdMicros: bigint;
	/** Positive ledger charges in the last 24 hours. */
	burnPerDayUsdMicros: bigint;
	/** Active keys the user made themselves (`account` product). */
	keys: {
		id: string;
		name: string;
		prefix: string;
		createdAt: Date;
		lastUsedAt: Date | null;
	}[];
	/** Calls with a revoked account key in the last 24 hours, one entry per key. */
	revokedKeyCalls: {
		keyId: string;
		name: string;
		prefix: string;
		revokedAt: Date | null;
		calls: number;
		lastAt: Date;
		/** Paths by call count, most first, at most 3. */
		topPaths: { path: string; calls: number }[];
	}[];
}

// ── Helpers ────────────────────────────────────────────────────────────

const RESOURCE = { kind: "account", id: "account", name: "Account" } as const;

function usd(micros: bigint): string {
	return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

function number(n: number): string {
	return n.toLocaleString("en-US");
}

function keyOf(row: RequestLogRow): string {
	return JSON.stringify([row.apiKeyId, row.pathTemplate, row.paramsHash]);
}

function groupRequests(rows: RequestLogRow[]): Map<string, RequestLogRow[]> {
	const out = new Map<string, RequestLogRow[]>();
	for (const row of rows) {
		const list = out.get(keyOf(row)) ?? [];
		list.push(row);
		out.set(keyOf(row), list);
	}
	return out;
}

const servedRows = (row: RequestLogRow) => row.rows ?? 0;

// ── duplicate_reads ────────────────────────────────────────────────────

interface PageSequence {
	startedAt: Date;
	pageSizes: number[];
	rows: number;
	signature: string;
}

/** Pages for one request, split into sequences at each first page. */
function sequencesOf(rows: RequestLogRow[]): PageSequence[] {
	const out: PageSequence[] = [];
	let current: RequestLogRow[] | null = null;
	const close = () => {
		if (current && current.length >= DUPLICATE_READS_MIN_PAGES) {
			out.push({
				startedAt: current[0]?.createdAt ?? new Date(0),
				pageSizes: current.map(servedRows),
				rows: current.reduce((sum, r) => sum + servedRows(r), 0),
				// Page size asked for and rows served, per page, in order.
				signature: current
					.map((r) => `${r.pageSize ?? 0}:${servedRows(r)}`)
					.join(","),
			});
		}
	};
	for (const row of rows) {
		if (row.cursorHash === null) {
			close();
			current = [row];
		} else if (current) {
			current.push(row);
		}
	}
	close();
	return out;
}

const duplicateReads: InsightRule<AccountRuleInput> = {
	id: "duplicate_reads",
	evaluate(input) {
		const since = input.now.getTime() - DUPLICATE_READS_LOOKBACK_MS;
		let best: {
			first: PageSequence;
			second: PageSequence;
			path: string;
		} | null = null;

		for (const rows of groupRequests(input.requests).values()) {
			const sequences = sequencesOf(rows);
			for (let j = 1; j < sequences.length; j++) {
				const second = sequences[j];
				if (!second || second.startedAt.getTime() < since) continue;
				for (let i = 0; i < j; i++) {
					const first = sequences[i];
					if (!first || first.signature !== second.signature) continue;
					const gap = second.startedAt.getTime() - first.startedAt.getTime();
					if (gap > DUPLICATE_READS_WINDOW_MS) continue;
					if (
						!best ||
						second.startedAt.getTime() > best.second.startedAt.getTime()
					) {
						best = { first, second, path: rows[0]?.pathTemplate ?? "" };
					}
				}
			}
		}
		if (!best) return null;

		const { first, second, path } = best;
		const pages = second.pageSizes.length;
		const times = `${utcTime(first.startedAt).replace(" UTC", "")} and ${utcTime(second.startedAt)}`;
		const detected: DetectedInsight = {
			rule: "duplicate_reads",
			severity: "costs",
			impact: second.rows,
			resource: RESOURCE,
			line: `The same ${number(second.rows)} rows were read twice`,
			meta: times,
			lead: "Looks like a loop starting over from the beginning.",
			body: `At ${utcTime(first.startedAt)} and again at ${utcTime(second.startedAt)}, the same ${plural(pages, "page")} came back for the same request on ${path}. Reading the same rows twice is billed twice.`,
			evidence: [
				{
					kind: "table",
					title: "The two reads",
					columns: ["Started", "Rows per page"],
					rows: [first, second].map((s) => [
						utcDateTime(s.startedAt),
						s.pageSizes.join(", "),
					]),
					markRow: 1,
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`read the same ${number(second.rows)} rows from ${path} twice, at ${utcTime(first.startedAt)} and ${utcTime(second.startedAt)}`,
						`Each read paged through ${plural(pages, "page")} with the same query and the same page sizes`,
					],
					lookAt:
						"Check whether a job or retry restarted from the first page instead of resuming from its saved cursor",
				}),
				commands: [],
			},
			how: {
				detector: `the same key, path and query produce the same ordered page sequence of ${DUPLICATE_READS_MIN_PAGES} or more pages twice within an hour`,
				facts: [
					["path", path],
					["pages per read", String(pages)],
					["rows per read", String(second.rows)],
					["first read", utcDateTime(first.startedAt)],
					["second read", utcDateTime(second.startedAt)],
				],
			},
		};
		return detected;
	},
};

// ── polling_loop ───────────────────────────────────────────────────────

function stddev(values: number[], mean: number): number {
	const variance =
		values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

/**
 * Requests split into polls. A request within `POLLING_FOLLOW_GAP_MS` of the
 * previous one is the loop following a cursor after a hit, not a new poll.
 */
function pollsOf(rows: RequestLogRow[]): RequestLogRow[][] {
	const polls: RequestLogRow[][] = [];
	let previous: RequestLogRow | undefined;
	for (const row of rows) {
		const current = polls[polls.length - 1];
		if (
			current &&
			previous &&
			row.createdAt.getTime() - previous.createdAt.getTime() <
				POLLING_FOLLOW_GAP_MS
		) {
			current.push(row);
		} else {
			polls.push([row]);
		}
		previous = row;
	}
	return polls;
}

const pollingLoop: InsightRule<AccountRuleInput> = {
	id: "polling_loop",
	evaluate(input) {
		const since = input.now.getTime() - POLLING_LOOKBACK_MS;
		let best: {
			rows: RequestLogRow[];
			polls: number;
			meanMs: number;
			empty: number;
		} | null = null;

		for (const all of groupRequests(input.requests).values()) {
			const rows = all.filter((r) => r.createdAt.getTime() >= since);
			const polls = pollsOf(rows);
			if (polls.length < POLLING_MIN_REQUESTS) continue;
			const starts = polls.map((p) => p[0]?.createdAt.getTime() ?? 0);
			const first = starts[0] ?? 0;
			const last = starts[starts.length - 1] ?? 0;
			if (last - first < POLLING_MIN_DURATION_MS) continue;

			const gaps = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
			const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
			if (mean <= 0 || stddev(gaps, mean) >= POLLING_MAX_STDDEV_RATIO * mean) {
				continue;
			}
			// The window still holds a loop that stopped (a revoked key, a job
			// turned off): only a loop that polled recently is still running.
			if (input.now.getTime() - last > POLLING_STALE_INTERVALS * mean) {
				continue;
			}
			const empty = polls.filter((p) =>
				p.every((r) => servedRows(r) === 0),
			).length;
			if (empty / polls.length < POLLING_MIN_EMPTY_RATIO) continue;
			if (!best || polls.length > best.polls) {
				best = { rows, polls: polls.length, meanMs: mean, empty };
			}
		}
		if (!best) return null;

		const { rows, polls, meanMs, empty } = best;
		const path = rows[0]?.pathTemplate ?? "";
		const first = rows[0]?.createdAt ?? input.now;
		const last = rows[rows.length - 1]?.createdAt ?? input.now;
		const hours = (last.getTime() - first.getTime()) / 3_600_000;
		const everySeconds = Math.max(1, Math.round(meanMs / 1000));
		const emptyPercent = Math.round((empty / polls) * 100);

		// Calls per minute for the last hour, split by whether rows came back.
		const minutes = 60;
		const end = Math.floor(input.now.getTime() / MINUTE_MS) * MINUTE_MS;
		const withRows = new Array<number>(minutes).fill(0);
		const emptyCalls = new Array<number>(minutes).fill(0);
		for (const r of rows) {
			const slot =
				minutes - 1 - Math.floor((end - r.createdAt.getTime()) / MINUTE_MS);
			if (slot < 0 || slot >= minutes) continue;
			if (servedRows(r) === 0) emptyCalls[slot] = (emptyCalls[slot] ?? 0) + 1;
			else withRows[slot] = (withRows[slot] ?? 0) + 1;
		}

		return {
			rule: "polling_loop",
			severity: "costs",
			impact: empty,
			resource: RESOURCE,
			line: `${path} is polled every ${everySeconds} seconds and mostly returns nothing`,
			meta: `${emptyPercent}% empty over ${hours.toFixed(1)} hours`,
			lead: "A loop is asking again and again for data that is not there yet.",
			body: `One request was repeated every ${everySeconds} seconds for ${hours.toFixed(1)} hours, and ${emptyPercent}% of the polls came back empty. Empty answers are free, but they hide when real data arrives. Index can hold a request open until new data arrives, so the loop can wait instead of asking.`,
			evidence: [
				{
					kind: "series",
					title: "Calls per minute, last hour",
					series: [
						{ name: "With rows", role: "a", points: withRows },
						{ name: "Empty", role: "context", points: emptyCalls },
					],
					labels: [
						[0, "60m ago"],
						[minutes - 1, "now"],
					],
					unit: "calls",
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`calls ${path} with the same query every ${everySeconds} seconds`,
						`${plural(polls, "poll")} over ${hours.toFixed(1)} hours, and ${emptyPercent}% of them returned no rows`,
					],
					lookAt:
						"Check which job runs this loop, and whether it should wait for new data or run on a longer schedule",
				}),
				commands: [],
			},
			how: {
				detector: `one request repeated at a steady interval (spread under ${Math.round(POLLING_MAX_STDDEV_RATIO * 100)}% of the mean) for ${POLLING_MIN_DURATION_MS / 3_600_000} hour or more, with ${Math.round(POLLING_MIN_EMPTY_RATIO * 100)}% or more empty polls; a request within ${POLLING_FOLLOW_GAP_MS / 1000} seconds of the previous one is a cursor page of the same poll`,
				facts: [
					["path", path],
					["interval", `${everySeconds}s`],
					["polls", String(polls)],
					["calls", String(rows.length)],
					["empty share", `${emptyPercent}%`],
				],
			},
		};
	},
};

// ── server_errors ──────────────────────────────────────────────────────

const serverErrors: InsightRule<AccountRuleInput> = {
	id: "server_errors",
	evaluate(input) {
		// Usage only: Index/Streams reads under /v1/. Dashboard and account calls
		// (/api/*) fail for reasons that are ours to fix, not the user's to retry.
		const failures = input.failed5xx.filter((f) => f.path.startsWith("/v1/"));
		if (failures.length < SERVER_ERRORS_MIN_5XX) return null;

		const byPath = new Map<string, number>();
		for (const f of failures) byPath.set(f.path, (byPath.get(f.path) ?? 0) + 1);
		const ranked = [...byPath.entries()].sort((a, b) => b[1] - a[1]);
		const times = failures.map((f) => f.createdAt.getTime());
		const first = new Date(Math.min(...times));
		const last = new Date(Math.max(...times));
		// One minute reads "at 16:50 UTC"; "16:50 UTC to 16:50 UTC" read as a bug.
		const sameMinute = utcTime(first) === utcTime(last);

		return {
			rule: "server_errors",
			severity: "losing",
			impact: failures.length,
			resource: RESOURCE,
			line: `${plural(failures.length, "request")} failed on our side`,
			meta: sameMinute
				? `at ${utcTime(first)}`
				: `${utcTime(first)} to ${utcTime(last)}`,
			lead: "Our fault, not yours.",
			body: `${sameMinute ? `At ${utcTime(first)}, ` : `Between ${utcTime(first)} and ${utcTime(last)}, `}${failures.length} of your requests got a server error from us. Nothing in your code caused it, and retrying is safe. This clears after an hour without new errors.`,
			evidence: [
				{
					kind: "table",
					title: "Failed requests by path",
					columns: ["Path", "Failures"],
					rows: ranked.slice(0, 6).map(([path, count]) => [path, count]),
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`got ${plural(failures.length, "server error")} (HTTP 5xx) ${sameMinute ? `at ${utcTime(first)}` : `between ${utcTime(first)} and ${utcTime(last)}`}`,
						// "Most" is only true when one path has strictly more failures than the next.
						ranked.length > 1 && ranked[0]?.[1] === ranked[1]?.[1]
							? `Spread across ${plural(ranked.length, "path")}`
							: `Most were on ${ranked[0]?.[0] ?? "one path"}`,
					],
					lookAt:
						"This is on Secondlayer's side. Make sure your client retries with backoff, and send the request ids from the error bodies if the errors continue",
				}),
				commands: [],
			},
			how: {
				detector: `${SERVER_ERRORS_MIN_5XX} or more 5xx answers for this account in the last hour`,
				facts: [
					["5xx answers, last hour", String(failures.length)],
					["first", utcDateTime(first)],
					["last", utcDateTime(last)],
				],
			},
		};
	},
};

// ── allowance_exhausted ────────────────────────────────────────────────

const allowanceExhausted: InsightRule<AccountRuleInput> = {
	id: "allowance_exhausted",
	evaluate(input) {
		const { firstPaidAt, paidRows, paidUsdMicros } = input.allowance;
		if (!firstPaidAt) return null;

		return {
			rule: "allowance_exhausted",
			severity: "costs",
			impact: Number(paidUsdMicros) / 1_000_000,
			resource: RESOURCE,
			line: `The free 1M rows ran out on ${utcDay(firstPaidAt)}`,
			meta: `${usd(paidUsdMicros)} so far this month`,
			lead: "You are past this month's free rows.",
			body: `Reads are billed per row after the first million each month. Since ${utcDateTime(firstPaidAt)}, ${plural(paidRows, "row")} cost ${usd(paidUsdMicros)}. The allowance resets on the 1st.`,
			evidence: [
				{
					kind: "table",
					title: "This month",
					columns: ["", ""],
					rows: [
						["Free rows ran out", utcDateTime(firstPaidAt)],
						["Paid rows since", number(paidRows)],
						["Cost since", usd(paidUsdMicros)],
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`used its free 1M rows for the month on ${utcDateTime(firstPaidAt)}`,
						`${plural(paidRows, "row")} since then cost ${usd(paidUsdMicros)}`,
					],
					lookAt:
						"Check which jobs read the most rows this month, and whether any of them can read less or read less often",
				}),
				commands: [],
			},
			how: {
				detector:
					"the first rows.delivered ledger row this month with a charge above zero",
				facts: [
					["allowance ran out", utcDateTime(firstPaidAt)],
					["paid rows since", String(paidRows)],
					["cost since", usd(paidUsdMicros)],
				],
			},
		};
	},
};

// ── backfill ───────────────────────────────────────────────────────────

const backfill: InsightRule<AccountRuleInput> = {
	id: "backfill",
	evaluate(input) {
		if (input.monthRows <= 0) return null;
		const day = input.rowsByDay.find(
			(d) =>
				d.rows >= BACKFILL_MIN_DAY_ROWS &&
				d.rows / input.monthRows > BACKFILL_DAY_SHARE &&
				d.pages > 0 &&
				d.fullPages / d.pages >= BACKFILL_FULL_PAGE_RATIO,
		);
		if (!day) return null;

		const share = Math.round((day.rows / input.monthRows) * 100);
		const date = new Date(`${day.day}T00:00:00.000Z`);
		return {
			rule: "backfill",
			severity: "costs",
			impact: day.rows,
			resource: RESOURCE,
			line: `${utcDay(date)} was a backfill`,
			meta: `${number(day.rows)} rows, ${share}% of the month`,
			lead: "That looks like a one-time history load.",
			body: `On ${utcDay(date)} you read ${number(day.rows)} rows, ${share}% of this month, and ${day.fullPages} of ${day.pages} pages were full. That is what a bulk history load looks like, and it cost ${usd(day.usdMicros)}. Paging history through the API is billed per row after the free million. Archive is priced per block range, so a repeat backfill of this size is usually cheaper there.`,
			evidence: [
				{
					kind: "table",
					title: "The backfill day",
					columns: ["", ""],
					rows: [
						["Day", utcDay(date)],
						["Rows", number(day.rows)],
						["Full pages", `${day.fullPages} of ${day.pages}`],
						["Cost", usd(day.usdMicros)],
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`read ${number(day.rows)} rows on ${utcDay(date)}, ${share}% of this month's total`,
						`${day.fullPages} of ${day.pages} pages were full, which looks like a bulk history load costing ${usd(day.usdMicros)}`,
					],
					lookAt:
						"Check whether this was a planned backfill. If you will repeat it, compare the cost against fetching the same history from Archive",
				}),
				commands: [],
			},
			how: {
				detector: `one day delivered more than ${Math.round(BACKFILL_DAY_SHARE * 100)}% of the month's rows, and ${Math.round(BACKFILL_FULL_PAGE_RATIO * 100)}% or more of its pages held ${PAGE_CAP_ROWS} rows`,
				facts: [
					["day", day.day],
					["rows", String(day.rows)],
					["full pages", `${day.fullPages} of ${day.pages}`],
					["share of month", `${share}%`],
				],
			},
		};
	},
};

// ── cap_pace ───────────────────────────────────────────────────────────

const capPace: InsightRule<AccountRuleInput> = {
	id: "cap_pace",
	evaluate(input) {
		const { monthlyCapCents, spentMonthUsdMicros, last7dChargesUsdMicros } =
			input.cap;
		if (monthlyCapCents === null) return null;
		const capMicros = BigInt(monthlyCapCents) * USD_MICROS_PER_CENT;
		// Already at the cap: the freeze is the news, not a forecast.
		if (spentMonthUsdMicros >= capMicros) return null;

		const dailyMicros = last7dChargesUsdMicros / 7n;
		if (dailyMicros <= 0n) return null;

		const monthEnd = new Date(
			Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth() + 1, 1),
		);
		const daysLeft = (monthEnd.getTime() - input.now.getTime()) / DAY_MS;
		const projected =
			spentMonthUsdMicros + BigInt(Math.round(Number(dailyMicros) * daysLeft));
		if (projected <= capMicros) return null;

		const daysToCap =
			Number(capMicros - spentMonthUsdMicros) / Number(dailyMicros);
		const hitAt = new Date(input.now.getTime() + daysToCap * DAY_MS);

		return {
			rule: "cap_pace",
			severity: "will_fail",
			impact: Number(projected - capMicros) / 1_000_000,
			resource: RESOURCE,
			line: `On pace to hit your ${usd(capMicros)} cap by ${utcDay(hitAt)}`,
			meta: `${usd(projected)} projected this month`,
			lead: "At this pace the spend cap stops your service before the month ends.",
			body: `You have spent ${usd(spentMonthUsdMicros)} of the ${usd(capMicros)} cap, and the last 7 days average ${usd(dailyMicros)} a day. That reaches the cap around ${utcDay(hitAt)}. When it does, reads return 402 and your hosted stack stops until the month resets or you raise the cap.`,
			evidence: [
				{
					kind: "table",
					title: "Cap pace",
					columns: ["", ""],
					rows: [
						["Monthly cap", usd(capMicros)],
						["Spent so far", usd(spentMonthUsdMicros)],
						["Daily average, last 7 days", usd(dailyMicros)],
						["Projected by month end", usd(projected)],
						["Cap reached around", utcDay(hitAt)],
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`has spent ${usd(spentMonthUsdMicros)} of its ${usd(capMicros)} monthly cap`,
						`The last 7 days average ${usd(dailyMicros)} a day, which reaches the cap around ${utcDay(hitAt)} and projects ${usd(projected)} by month end`,
					],
					lookAt:
						"Decide whether to raise the cap or cut usage, and check which jobs account for the daily spend",
					followUp: "Then run sl credits balance",
				}),
				commands: ["sl credits balance"],
			},
			how: {
				detector:
					"the month-end projection from the last 7 days' daily average exceeds the monthly cap",
				facts: [
					["cap", usd(capMicros)],
					["spent", usd(spentMonthUsdMicros)],
					["daily average", usd(dailyMicros)],
					["projected", usd(projected)],
					["cap reached", utcDateTime(hitAt)],
				],
			},
		};
	},
};

// ── credits_runway ─────────────────────────────────────────────────────

const creditsRunway: InsightRule<AccountRuleInput> = {
	id: "credits_runway",
	evaluate(input) {
		const days = runwayDays(input.balanceUsdMicros, input.burnPerDayUsdMicros);
		if (!Number.isFinite(days) || days > CREDITS_RUNWAY_WARN_DAYS) return null;

		const outAt = new Date(input.now.getTime() + Math.max(0, days) * DAY_MS);
		const whole = Math.max(0, Math.floor(days));
		return {
			rule: "credits_runway",
			severity: "will_fail",
			impact: Number(input.burnPerDayUsdMicros) / 1_000_000,
			resource: RESOURCE,
			line: `Credits run out in about ${plural(whole, "day")}`,
			meta: `${usd(input.balanceUsdMicros)} left at ${usd(input.burnPerDayUsdMicros)} a day`,
			lead: "Your balance is about to run out.",
			body: `At ${usd(input.burnPerDayUsdMicros)} a day, ${usd(input.balanceUsdMicros)} lasts until around ${utcDay(outAt)}. At zero your hosted stack stops and paid reads answer 402.`,
			evidence: [
				{
					kind: "table",
					title: "Runway",
					columns: ["", ""],
					rows: [
						["Balance", usd(input.balanceUsdMicros)],
						["Burn per day", usd(input.burnPerDayUsdMicros)],
						["Runs out around", utcDay(outAt)],
					],
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer account",
					observed: [
						`has ${usd(input.balanceUsdMicros)} of credits left, burning ${usd(input.burnPerDayUsdMicros)} a day`,
						`That runs out around ${utcDay(outAt)}`,
					],
					lookAt: "Decide whether to top up now or reduce what is running",
					followUp: "Then run sl credits buy",
				}),
				commands: ["sl credits buy"],
			},
			how: {
				detector: `balance divided by the last 24 hours of spend is ${CREDITS_RUNWAY_WARN_DAYS} days or less`,
				facts: [
					["balance", usd(input.balanceUsdMicros)],
					["burn per day", usd(input.burnPerDayUsdMicros)],
					["runway", `${days.toFixed(1)} days`],
					["runs out", utcDateTime(outAt)],
				],
			},
		};
	},
};

// ── key_unused ─────────────────────────────────────────────────────────

const keyUnused: InsightRule<AccountRuleInput> = {
	id: "key_unused",
	evaluate(input) {
		const stale = input.keys
			.map((key) => {
				const since = key.lastUsedAt ?? key.createdAt;
				return {
					key,
					since,
					days: Math.floor((input.now.getTime() - since.getTime()) / DAY_MS),
				};
			})
			.filter((entry) => entry.days >= KEY_UNUSED_DAYS)
			.sort((a, b) => a.since.getTime() - b.since.getTime());
		if (stale.length === 0) return null;

		const one = stale.length === 1;
		const names = stale.map((entry) => entry.key.name);
		return {
			rule: "key_unused",
			severity: "costs",
			impact: stale.length,
			resource: RESOURCE,
			line: one
				? `${names[0]} hasn't read anything in ${stale[0]?.days} days`
				: `${stale.length} keys haven't read anything in ${KEY_UNUSED_DAYS}+ days`,
			meta: one
				? `created ${utcDay(stale[0]?.key.createdAt as Date)}`
				: names.join(", "),
			lead: "A key nobody uses is the one nobody notices when it leaks.",
			body: one
				? "It still works, and every row it reads is billed to you. Revoke it if nothing runs with it."
				: "They still work, and every row they read is billed to you. Revoke them if nothing runs with them.",
			evidence: [
				{
					kind: "table",
					title: "Unused keys",
					columns: ["Key", "Last read"],
					rows: stale.map(({ key }) => [
						`${key.name} (${key.prefix}…)`,
						key.lastUsedAt ? utcDay(key.lastUsedAt) : "never",
					]),
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer API keys",
					observed: stale.map(
						({ key, days }) =>
							`${key.name} (${key.prefix}…) has not read anything in ${days} days`,
					),
					lookAt:
						"Check whether anything still runs with these keys, and revoke the ones nothing uses",
				}),
				commands: [],
			},
			how: {
				detector: `account key with no reads for ${KEY_UNUSED_DAYS} days or more`,
				facts: stale.map(({ key, days }): [string, string] => [
					key.name,
					`${days} days idle, ${key.lastUsedAt ? `last read ${utcDateTime(key.lastUsedAt)}` : `never read, created ${utcDateTime(key.createdAt)}`}`,
				]),
			},
		};
	},
};

// ── revoked_key_in_use ─────────────────────────────────────────────────

const revokedKeyInUse: InsightRule<AccountRuleInput> = {
	id: "revoked_key_in_use",
	evaluate(input) {
		const active = input.revokedKeyCalls.filter(
			(k) => input.now.getTime() - k.lastAt.getTime() <= REVOKED_KEY_ACTIVE_MS,
		);
		if (active.length === 0) return null;

		const revoked = (k: (typeof active)[number]) =>
			`was revoked${k.revokedAt ? ` on ${utcDay(k.revokedAt)}` : ""}`;
		const one = active.length === 1 ? active[0] : undefined;
		return {
			rule: "revoked_key_in_use",
			severity: "losing",
			impact: active.reduce((sum, k) => sum + k.calls, 0),
			resource: RESOURCE,
			line: one
				? `${one.name} ${revoked(one)} and is still being called`
				: `${active.length} revoked keys are still being called`,
			meta: one
				? `${plural(one.calls, "call")} in 24 hours · mostly ${one.topPaths[0]?.path}`
				: active.map((k) => k.name).join(", "),
			lead: "Something still runs with a key you revoked, and every call it makes fails.",
			body: "Make a new key and replace the revoked one wherever it is configured: an app's environment, a scheduled job, or the CLI (sl login). The calls stop failing as soon as it reads with the new key.",
			evidence: [
				{
					kind: "table",
					title: "Revoked keys still in use",
					columns: ["Key", "Revoked", "Calls (24h)", "Last call", "Paths"],
					rows: active.map((k) => [
						`${k.name} (${k.prefix}…)`,
						k.revokedAt ? utcDay(k.revokedAt) : "unknown",
						number(k.calls),
						utcDateTime(k.lastAt),
						k.topPaths.map((p) => p.path).join(", "),
					]),
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: "My Secondlayer API keys",
					observed: active.map(
						(k) =>
							`${k.name} (${k.prefix}…) ${revoked(k)} and was called ${plural(k.calls, "time")} in the last 24 hours, mostly ${k.topPaths[0]?.path}`,
					),
					lookAt:
						"Find where each revoked key is still configured (app environment variables, scheduled jobs, CLI config) and replace it with a new key",
				}),
				commands: [],
			},
			how: {
				detector: `account key with status revoked, called within the last ${REVOKED_KEY_ACTIVE_MS / MINUTE_MS} minutes (calls answer 401 KEY_REVOKED)`,
				facts: active.map((k): [string, string] => [
					k.name,
					`${k.calls} calls in 24h, last ${utcDateTime(k.lastAt)}`,
				]),
			},
		};
	},
};

export const ACCOUNT_RULES: InsightRule<AccountRuleInput>[] = [
	duplicateReads,
	pollingLoop,
	serverErrors,
	allowanceExhausted,
	backfill,
	capPace,
	creditsRunway,
	keyUnused,
	revokedKeyInUse,
];
