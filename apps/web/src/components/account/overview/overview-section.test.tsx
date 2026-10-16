import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { rowModel } from "../webhooks/rows";
import { FIXTURE_HOURS, summary } from "../webhooks/webhook.fixtures";
import {
	OverviewBody,
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
