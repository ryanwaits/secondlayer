import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS, FIXTURE_STACK } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionableInsights, InsightActions } from "./insight-actions";

const byRule = (rule: string): Insight => {
	const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
	if (!found) throw new Error(`missing fixture ${rule}`);
	return found;
};

describe("InsightActions", () => {
	test("offers both actions on a live insight", () => {
		const html = renderToStaticMarkup(
			<InsightActions insight={byRule("receiver_down")} />,
		);
		expect(html).toContain("Got it");
		expect(html).toContain("This is expected");
		expect(html).toContain(
			"Clears itself once the numbers are back to normal.",
		);
	});

	test("a recovered incident can only be dismissed", () => {
		const html = renderToStaticMarkup(
			<InsightActions insight={byRule("retries_recovered")} />,
		);
		expect(html).toContain("Got it");
		expect(html).not.toContain("This is expected");
		expect(html).toContain("Recovered incidents stay listed for 24 hours.");
	});
});

describe("ActionableInsights", () => {
	test("renders nothing for an empty list", () => {
		expect(renderToStaticMarkup(<ActionableInsights insights={[]} />)).toBe("");
	});

	test("one losing insight is an open note with actions and no stack header", () => {
		const html = renderToStaticMarkup(
			<ActionableInsights insights={[byRule("receiver_down")]} />,
		);
		expect(html).not.toContain("worst first");
		expect(html).toContain("ins-card");
		expect(html).toContain("Got it");
	});

	test("one costs insight stays collapsed", () => {
		const html = renderToStaticMarkup(
			<ActionableInsights insights={[byRule("duplicate_webhook")]} />,
		);
		expect(html).not.toContain("ins-card");
	});

	test("several insights are the ranked stack with one open card and its actions", () => {
		const html = renderToStaticMarkup(
			<ActionableInsights insights={FIXTURE_STACK} />,
		);
		expect(html).toContain("4 insights");
		expect(html.match(/class="ins-card"/g)).toHaveLength(1);
		expect(html.match(/Got it/g)).toHaveLength(1);
	});
});
