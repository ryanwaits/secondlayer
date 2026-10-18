import { describe, expect, test } from "bun:test";
import { type Insight, SEVERITY_WORD } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { InsightRow } from "./insight-row";
import { InsightSheetBody } from "./insight-sheet";
import { InsightsScreen } from "./insights-screen";

const byRule = (rule: string): Insight => {
	const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
	if (!found) throw new Error(`missing fixture ${rule}`);
	return found;
};

const noop = () => {};

describe("InsightSheetBody", () => {
	test("names the cause when confidence is at least 0.85", () => {
		const html = renderToStaticMarkup(
			<InsightSheetBody insight={byRule("receiver_down")} />,
		);
		expect(html).toContain("Likely cause · 93% sure");
	});

	test("names no cause below 0.85", () => {
		const insight = byRule("dns_retries_recovered");
		expect(insight.how.label?.confidence).toBeLessThan(0.85);
		const html = renderToStaticMarkup(<InsightSheetBody insight={insight} />);
		expect(html).not.toContain("Likely cause");
	});

	test("shows the extra action beside the primary one", () => {
		const html = renderToStaticMarkup(
			<InsightSheetBody
				insight={byRule("receiver_down")}
				extraAction={<button type="button">Share fix</button>}
			/>,
		);
		expect(html).toContain("Share fix");
		expect(html).toContain('href="/account/webhooks/wh-deposits"');
		expect(html).toContain("Open sbtc-deposits");
	});
});

describe("InsightRow", () => {
	test("shows the severity word, the lead and the NEW chip", () => {
		const insight = byRule("receiver_down");
		const html = renderToStaticMarkup(
			<InsightRow
				insight={insight}
				isNew
				onOpen={noop}
				onSnooze={noop}
				onDone={noop}
			/>,
		);
		expect(html).toContain(SEVERITY_WORD.losing);
		expect(html).toContain(">NEW<");
		expect(html).toContain("Until tomorrow");
		expect(html).toContain("Done");
	});

	test("a recovered row has no swipe actions and no NEW chip", () => {
		const html = renderToStaticMarkup(
			<InsightRow
				insight={byRule("retries_recovered")}
				isNew
				onOpen={noop}
				onSnooze={noop}
				onDone={noop}
			/>,
		);
		expect(html).toContain("Recovered");
		expect(html).not.toContain("Until tomorrow");
		expect(html).not.toContain(">NEW<");
	});
});

describe("InsightsScreen", () => {
	const source = (data: Insight[], ready = true) => ({
		ready,
		data,
		snooze: async () => true,
		dismiss: async () => true,
		restore: async () => true,
	});

	test("counts open insights and lists them", () => {
		const html = renderToStaticMarkup(
			<InsightsScreen source={source(FIXTURE_INSIGHTS)} />,
		);
		expect(html).toMatch(/\d+ open/);
		expect(html).toContain(byRule("receiver_down").lead);
	});

	test("an account with no insights at all says nothing to tell yet", () => {
		const html = renderToStaticMarkup(<InsightsScreen source={source([])} />);
		expect(html).toContain("Nothing to tell you yet");
		expect(html).toContain("Nothing open");
	});

	test("only recovered insights means all clear", () => {
		const html = renderToStaticMarkup(
			<InsightsScreen
				source={source(FIXTURE_INSIGHTS.filter((i) => i.resolvedAt))}
			/>,
		);
		expect(html).toContain("All clear");
	});
});
