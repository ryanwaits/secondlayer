import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { forAccountRules } from "@/lib/insights-store";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { ApiKey } from "@/lib/types";
import { renderToStaticMarkup } from "react-dom/server";
import { rowModel } from "../webhooks/rows";
import { FIXTURE_HOURS, summary } from "../webhooks/webhook.fixtures";
import {
	OVERVIEW_ACCOUNT_RULES,
	OverviewBody,
	OverviewKeysRow,
	OverviewRowsSlot,
	OverviewSubgraphsSlot,
} from "./overview-section";

const delivered = new Array<number>(168).fill(3);
const failed = new Array<number>(168).fill(0);
const series = { delivered, failed };

const healthy = rowModel(summary(), series, FIXTURE_HOURS, []);
const second = rowModel(
	summary({ id: "wh_vault", name: "vault-events" }),
	series,
	FIXTURE_HOURS,
	[],
);
const quiet = rowModel(
	summary({
		id: "wh_waiting",
		name: "sentinel:example-watch",
		lastDeliveryAt: null,
		lastSuccessAt: null,
	}),
	undefined,
	FIXTURE_HOURS,
	[],
);

const base = {
	billing: { creditsUsdMicros: "28230000", spentThisMonthUsdMicros: "6210000" },
	burn: null,
	stack: null,
	deliveredRows: null,
};

const render = (rows: (typeof healthy)[] | null) =>
	renderToStaticMarkup(<OverviewBody {...base} rows={rows} />);

describe("OverviewBody account insights", () => {
	const byRule = (rule: string): Insight => {
		const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
		if (!found) throw new Error(`missing fixture ${rule}`);
		return found;
	};

	test("the open note's card is the same insight, and read-loop notes stay off Overview", () => {
		const cap = byRule("cap_pace");
		const runway: Insight = {
			...cap,
			id: "ins-credits-runway",
			rule: "credits_runway",
			impact: 3,
			line: "Credits run out in 9 days",
			lead: "Your credits run out before the month does.",
		};
		const reads = byRule("duplicate_reads");
		const shown = forAccountRules([reads, runway, cap], OVERVIEW_ACCOUNT_RULES);
		expect(shown.map((i) => i.id)).toEqual([cap.id, runway.id]);

		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} accountInsights={shown} />,
		);
		// Both notes list; only the top one (cap pace) is open, with its own lead.
		expect(html).toContain(cap.line);
		expect(html).toContain(runway.line);
		expect(html.match(/class="ins-card"/g)).toHaveLength(1);
		expect(html).toContain(cap.lead);
		expect(html).not.toContain(runway.lead);
		// The read-loop insight belongs to Rows.
		expect(html).not.toContain(reads.line);
		expect(html).not.toContain(reads.lead);
		// The open card sits right after the cap-pace note line.
		expect(html.indexOf(cap.lead)).toBeGreaterThan(html.indexOf(cap.line));
		expect(html.indexOf(cap.lead)).toBeLessThan(html.indexOf(runway.line));
	});

	const account = FIXTURE_INSIGHTS.find((i) => i.rule === "duplicate_reads");

	test("account insights render as notes under the rows", () => {
		if (!account) throw new Error("missing fixture");
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} accountInsights={[account]} />,
		);
		expect(html.indexOf(account.line)).toBeGreaterThan(
			html.indexOf("dash-rows"),
		);
	});

	test("no account insights renders no note", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} accountInsights={[]} />,
		);
		expect(html).not.toContain("ins-note");
	});
});

describe("OverviewBody", () => {
	test("says everything is delivering and draws a row per active webhook", () => {
		const html = render([healthy, second, quiet]);
		expect(html).toContain("Everything is delivering.");
		expect(html).toContain('href="/account/webhooks/wh_deposits"');
		expect(html).toContain('href="/account/webhooks/wh_vault"');
		expect(html).toContain("Delivered 72 in 24h");
		expect(html).toContain("3 webhooks");
		expect(html).toContain("$28.23 in credits");
	});

	test("webhooks that never matched fold into one quiet group row", () => {
		const html = render([healthy, quiet]);
		expect(html).toContain("1 more webhook");
		expect(html).toContain("Waiting for their first match");
		expect(html).not.toContain("example-watch");
	});

	test("a losing insight turns the sentence into a count of what needs attention", () => {
		const losing = rowModel(summary(), series, FIXTURE_HOURS, [
			FIXTURE_INSIGHTS[0] as never,
		]);
		const html = render([losing, second]);
		expect(html).toContain("1 webhook needs attention.");
		expect(html).toContain("Receiver returning 502 since 16:06");
		expect(html).toContain("Why");
	});

	test("a second insight on the same webhook adds +1 after the state line", () => {
		const two = rowModel(summary(), series, FIXTURE_HOURS, [
			FIXTURE_INSIGHTS[0] as never,
			FIXTURE_INSIGHTS[1] as never,
		]);
		const html = render([two]);
		expect(html).toContain(">+1<");
		expect(html).not.toContain(">+2<");
	});

	test("no webhooks yet is its own sentence, not an error", () => {
		expect(render([])).toContain("No webhooks yet.");
	});

	test("before the list loads, it does not claim anything is delivering", () => {
		const html = render(null);
		expect(html).toContain("Checking your account.");
		expect(html).not.toContain("Everything is delivering.");
	});

	test("the hosted stack row and the month meter render from billing data", () => {
		const html = renderToStaticMarkup(
			<OverviewBody
				{...base}
				rows={[healthy]}
				stack={{
					state: "running",
					lastChargedAt: null,
					memory24h: [
						{ hour: "2026-10-15T10:00:00Z", billedGb: 0.25, observedGb: 0.3 },
						{ hour: "2026-10-15T11:00:00Z", billedGb: 0.25, observedGb: 0.31 },
					],
				}}
				deliveredRows={400_000}
			/>,
		);
		expect(html).toContain("hosted stack");
		expect(html).toContain("0.31 GB");
		expect(html).toContain("400,000 of 1M free rows used");
		expect(html).toContain("$6.21");
	});

	test("the rows slot renders nothing until its data loads, and the subgraphs slot until its screen fills it", () => {
		expect(renderToStaticMarkup(<OverviewRowsSlot />)).toBe("");
		expect(renderToStaticMarkup(<OverviewSubgraphsSlot />)).toBe("");
	});
});

describe("OverviewKeysRow", () => {
	const NOW = new Date("2026-10-15T12:00:00.000Z");
	const daysAgo = (n: number) =>
		new Date(NOW.getTime() - n * 86_400_000).toISOString();
	const key = (patch: Partial<ApiKey>): ApiKey => ({
		id: "k",
		prefix: "sk-sl_abc12345",
		name: "laptop",
		status: "active",
		product: "account",
		tier: null,
		createdAt: daysAgo(100),
		lastUsedAt: daysAgo(0),
		rowsDaily: new Array<number>(30).fill(5),
		...patch,
	});
	const row = (keys: ApiKey[] | null) =>
		renderToStaticMarkup(<OverviewKeysRow keys={keys} now={NOW} />);

	test("links to the Keys tab with the count, the last read and a sparkline", () => {
		const html = row([key({ id: "a" }), key({ id: "b", name: "ci" })]);
		expect(html).toContain('href="/account/keys"');
		expect(html).toContain("2 keys · laptop read");
		expect(html).toContain("dc-svg");
		expect(html).not.toContain("dash-dot hi");
	});

	test("a stale key adds a yellow dot and its name", () => {
		const html = row([
			key({ id: "a" }),
			key({ id: "b", name: "old-indexer", lastUsedAt: daysAgo(40) }),
		]);
		expect(html).toContain("dash-dot hi");
		expect(html).toContain("old-indexer unused 40 days");
	});

	test("hidden until keys load and when there are none of your own", () => {
		expect(row(null)).toBe("");
		expect(row([])).toBe("");
		expect(row([key({ product: "docs" })])).toBe("");
	});

	test("the Overview draws it before the hosted stack row", () => {
		const html = renderToStaticMarkup(
			<OverviewBody
				{...base}
				rows={[healthy]}
				keys={[key({ id: "a" })]}
				now={NOW}
				stack={{ state: "none", lastChargedAt: null, memory24h: [] }}
			/>,
		);
		expect(html.indexOf("1 key ·")).toBeGreaterThan(-1);
		expect(html.indexOf("1 key ·")).toBeLessThan(html.indexOf("hosted stack"));
	});
});
