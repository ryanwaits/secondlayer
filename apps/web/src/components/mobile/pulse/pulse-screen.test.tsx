import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { RowsResponse } from "@/lib/rows";
import type { WebhooksActivitySummary } from "@/lib/webhooks-data";
import { renderToStaticMarkup } from "react-dom/server";
import { PulseBody, type PulseBodyProps } from "./pulse-screen";

const now = new Date("2026-10-18T14:30:00.000Z");

const hours = Array.from({ length: 48 }, (_, i) =>
	new Date(
		Date.parse("2026-10-16T14:00:00.000Z") + i * 3_600_000,
	).toISOString(),
);
const summary: WebhooksActivitySummary = {
	hours,
	webhooks: [
		{
			id: "wh-a",
			delivered: hours.map(() => 10),
			failed: hours.map((_, i) => (i > 44 ? 6 : 0)),
		},
	],
};
const rows: RowsResponse = {
	allowance: {
		monthly: 1_000_000,
		usedThisMonth: 18_200,
		exhaustedOn: null,
		paidRowsThisMonth: 0,
		paidUsdMicrosThisMonth: "0",
		resetsOn: "2026-11-01",
	},
	daily: [],
	hourlyToday: [
		{ hour: "2026-10-18T09:00:00.000Z", source: "api", rows: 500, calls: 5 },
	],
	bySource: [],
	histogram: [],
	errors: [],
};

const base: PulseBodyProps = {
	insights: FIXTURE_INSIGHTS,
	summary,
	rows,
	billing: { creditsUsdMicros: "0", spentThisMonthUsdMicros: "40100000" },
	caps: {
		monthlyCapCents: 5000,
		alertThresholdPct: 80,
		frozenAt: null,
		alertSentAt: null,
	},
	webhookCount: 4,
	subgraphCount: 3,
	isNew: false,
	loaded: true,
	now,
	updated: "just now",
	seenAt: 0,
	onOpen: () => {},
};

const render = (props: Partial<PulseBodyProps>) =>
	renderToStaticMarkup(<PulseBody {...base} {...props} />);

describe("PulseBody", () => {
	test("lists what needs you with the worst insight's lead", () => {
		const html = render({});
		expect(html).toContain("Needs you");
		expect(html).toContain("Your receiver is down, not the chain.");
		expect(html).toContain("Last 24 hours");
		expect(html).toContain("$40.10 of $50");
	});

	test("says all delivering when nothing needs you", () => {
		const html = render({ insights: [] });
		expect(html).toContain("All delivering");
		expect(html).toContain("4 webhooks, 3 subgraphs. Nothing failed in 24 h.");
	});

	test("a new account gets the empty card and a month, not the 24-hour view", () => {
		const html = render({ isNew: true, webhookCount: 0, subgraphCount: 0 });
		expect(html).toContain("Nothing running yet");
		expect(html).toContain("Send yourself the link");
		expect(html).toContain("18,200 of 1M free");
		expect(html).not.toContain("Last 24 hours");
	});

	test("never draws a chain card", () => {
		for (const props of [{}, { insights: [] }, { isNew: true }]) {
			const html = render(props);
			expect(html).not.toContain("Stacks");
			expect(html).not.toContain("Bitcoin");
		}
	});
});
