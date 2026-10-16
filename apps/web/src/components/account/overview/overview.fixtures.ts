import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { RowsResponse } from "@/lib/rows";
import type {
	SubgraphHealthData,
	SubgraphListItem,
} from "@/lib/subgraphs-store";
import type { ApiKey } from "@/lib/types";
import type { HostedStack } from "@/lib/usage";
import { type WebhookRowModel, rowModel } from "../webhooks/rows";
import { FIXTURE_HOURS, summary } from "../webhooks/webhook.fixtures";
import type { OverviewBodyProps } from "./overview-section";

/**
 * Example Overview data for tests and lab stories. Example names and round
 * numbers only: never real account data. Times hang off `now`, so "10 minutes
 * ago" stays that whenever it renders.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A 168-hour series with deliveries at these positions of the last 24 hours. */
function hourly(delivered: number[], failed: number[] = []) {
	const make = (at: number[]) => {
		const out = new Array<number>(168).fill(0);
		for (const i of at) out[168 - 24 + i] = 1;
		return out;
	};
	return { delivered: make(delivered), failed: make(failed) };
}

/** The "server errors" insight on the Rows cell, active or already recovered. */
export function serverErrorsInsight(recovered = false): Insight {
	return {
		id: "ins-server-errors",
		rule: "server_errors",
		severity: recovered ? "recovered" : "losing",
		impact: 3,
		resource: { kind: "account", id: "acct-example", name: "Account" },
		line: "3 requests failed on our side",
		meta: recovered ? "16:50 UTC · recovered" : "16:50 UTC",
		lead: `Our fault, not yours. At 16:50 UTC, 3 of your requests got a server error from us. Nothing in your code caused it, and retrying is safe. ${recovered ? "No new errors for an hour, so this has cleared." : "This clears after an hour without new errors."}`,
		body: "Three reads got a 5xx answer from Secondlayer within the same minute.",
		evidence: [
			{
				kind: "table",
				title: "Failed requests by path",
				columns: ["Path", "Failures"],
				rows: [
					["/v1/index/events", 1],
					["/v1/index/transfers", 1],
					["/v1/streams/events", 1],
				],
			},
		],
		handoff: {
			prompt:
				"My Secondlayer account got 3 server errors (HTTP 5xx) at 16:50 UTC, spread across 3 paths. This is on Secondlayer's side. Make sure your client retries with backoff, and send the request ids from the error bodies if the errors continue.",
			commands: [],
		},
		how: {
			detector: "3 or more 5xx answers for this account in the last hour",
			facts: [
				["5xx answers, last hour", "3"],
				["first", "2026-10-16 16:50 UTC"],
				["last", "2026-10-16 16:50 UTC"],
			],
		},
		createdAt: "2026-10-16T16:50:00.000Z",
		resolvedAt: recovered ? "2026-10-16T17:50:00.000Z" : null,
	};
}

/** This month: past the free 1M, with a little read today. */
export function exampleRows(now: Date): RowsResponse {
	const hour = (ago: number, rows: number) => ({
		hour: new Date(
			Math.floor(now.getTime() / HOUR) * HOUR - ago * HOUR,
		).toISOString(),
		source: "index",
		rows,
		calls: 1,
	});
	return {
		allowance: {
			monthly: 1_000_000,
			usedThisMonth: 1_260_000,
			exhaustedOn: "2026-10-06",
			paidRowsThisMonth: 260_000,
			paidUsdMicrosThisMonth: "1300000",
			resetsOn: "2026-11-01",
		},
		daily: [],
		hourlyToday: [hour(3, 20), hour(2, 12), hour(1, 20)],
		bySource: [],
		histogram: [],
		errors: [],
	};
}

/** One key, read today and on no other day in the last 24. */
export function exampleKeys(now: Date): ApiKey[] {
	const rowsDaily = new Array<number>(30).fill(0);
	rowsDaily[29] = 52;
	return [
		{
			id: "k_example",
			prefix: "sk-sl_example",
			name: "prod-indexer",
			status: "active",
			product: "account",
			tier: null,
			createdAt: new Date(now.getTime() - 100 * DAY).toISOString(),
			lastUsedAt: new Date(now.getTime() - HOUR).toISOString(),
			rowsDaily,
		},
	];
}

export function exampleStack(state: HostedStack["state"], now: Date) {
	const memory24h = Array.from({ length: 24 }, (_, i) => ({
		hour: new Date(now.getTime() - (23 - i) * HOUR).toISOString(),
		billedGb: 0.2,
		observedGb: i % 5 === 0 ? 0.19 : 0.2,
	}));
	return {
		state,
		lastChargedAt: null,
		memory24h: state === "none" ? [] : memory24h,
	} satisfies HostedStack;
}

/** The webhook rows: two that deliver (one failing, if asked) and six that never matched. */
export function exampleWebhooks(
	now: Date,
	{ failing = false }: { failing?: boolean } = {},
): WebhookRowModel[] {
	const recent = (minutes: number) =>
		new Date(now.getTime() - minutes * 60_000).toISOString();
	const first = failing
		? rowModel(
				summary({
					id: "wh_first",
					name: "sbtc-deposits",
					lastDeliveryAt: recent(180),
				}),
				hourly([2], [16, 19, 21, 23]),
				FIXTURE_HOURS,
				FIXTURE_INSIGHTS.slice(0, 1),
			)
		: rowModel(
				summary({
					id: "wh_first",
					name: "sbtc-deposits",
					lastDeliveryAt: recent(10),
				}),
				hourly([2, 16, 23]),
				FIXTURE_HOURS,
				[],
			);
	const second = rowModel(
		summary({
			id: "wh_second",
			name: "vault-events",
			lastDeliveryAt: recent(120),
		}),
		hourly([0, 2, 4, 16, 20]),
		FIXTURE_HOURS,
		[],
	);
	const waiting = Array.from({ length: 6 }, (_, i) =>
		rowModel(
			summary({
				id: `wh_waiting_${i}`,
				name: `waiting-${i + 1}`,
				lastDeliveryAt: null,
				lastSuccessAt: null,
			}),
			undefined,
			FIXTURE_HOURS,
			[],
		),
	);
	return [first, second, ...waiting];
}

/** One subgraph that is at the tip and wrote through the day. */
export function exampleSubgraph(now: Date): {
	item: SubgraphListItem;
	health: SubgraphHealthData;
} {
	const written = [
		3, 5, 2, 8, 4, 6, 9, 3, 5, 7, 4, 6, 2, 8, 5, 3, 6, 4, 7, 5, 6, 3, 4, 6,
	];
	return {
		item: {
			name: "sbtc-flows",
			version: "1.0.0",
			status: "active",
			lastProcessedBlock: 900_000,
			totalRows: 1204,
			totalErrors: 0,
			tables: ["flows"],
			blocksRemaining: 0,
			updatedAt: new Date(now.getTime() - 60_000).toISOString(),
			createdAt: new Date(now.getTime() - 30 * DAY).toISOString(),
		},
		health: {
			errors24h: 0,
			hours: written.map((rowsWritten, i) => ({
				hour: new Date(now.getTime() - (23 - i) * HOUR).toISOString(),
				lagBlocks: 0,
				rowsWritten,
				errors: 0,
				eventsHandled: rowsWritten,
			})),
		},
	};
}

/** The props for a healthy account; each state overrides what it changes. */
export function exampleOverview(
	now: Date,
	over: Partial<OverviewBodyProps> = {},
): OverviewBodyProps {
	return {
		rows: exampleWebhooks(now),
		billing: {
			creditsUsdMicros: "28090000",
			spentThisMonthUsdMicros: "1910000",
		},
		burn: { rateDayUsdMicros: "330000", windowHours: 24 },
		stack: exampleStack("running", now),
		readUsage: exampleRows(now),
		keys: exampleKeys(now),
		now,
		...over,
	};
}
