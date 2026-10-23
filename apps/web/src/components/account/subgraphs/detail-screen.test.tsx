import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { SubgraphDetailBody } from "./detail-screen";
import {
	EXAMPLE_NOW,
	exampleDetail,
	exampleErrors,
	exampleHealth,
} from "./subgraph.fixtures";

const render = (
	over: Partial<Parameters<typeof SubgraphDetailBody>[0]> = {},
): string =>
	renderToStaticMarkup(
		<SubgraphDetailBody
			detail={exampleDetail}
			health={exampleHealth()}
			errors={[]}
			range="24h"
			onRange={() => {}}
			{...over}
		/>,
	);

const failing = () =>
	render({
		detail: { ...exampleDetail, status: "error" },
		health: exampleHealth(3),
		errors: exampleErrors,
		now: EXAMPLE_NOW,
		insights: [FIXTURE_INSIGHTS[0] as (typeof FIXTURE_INSIGHTS)[number]],
	});

describe("SubgraphDetailBody", () => {
	test("a healthy page has facts, the lede, tables and the change commands, no grid", () => {
		const html = render();
		expect(html).toContain("Live at block 9,218,411 · v3.0.0");
		for (const label of ["Behind tip", "Rows", "Errors · 24h", "Storage"])
			expect(html).toContain(label);
		expect(html).not.toContain("Version<b>");
		expect(html).toContain("443,957");
		expect(html).toContain("1.2 GB");
		expect(html).toContain("sl subgraphs deploy --help");
		expect(html).toContain("sl subgraphs reindex sbtc-deposits");
		expect(html).toContain("sl subgraphs stop sbtc-deposits");
		for (const gone of [
			"sg-grid",
			"sg-tabs",
			"sg-panel",
			"Rows written per hour",
		])
			expect(html).not.toContain(gone);
	});

	test("the name opens the drawer and the breadcrumb goes to the account", () => {
		const html = render();
		expect(html).toContain('data-tip="Click for schema and details"');
		expect(html).toContain('href="/account#subgraphs"');
	});

	test("each table is a row with its count", () => {
		const html = render();
		expect(html).toMatch(/sg-table-name">transfers<.*?<b>412,880<\/b> rows/);
		expect(html).toMatch(/sg-table-name">holders<.*?<b>31,077<\/b> rows/);
	});

	test("the chart title follows the range", () => {
		expect(render()).toContain("Rows written · 24h");
		expect(render({ range: "7d", weekHealth: exampleHealth() })).toContain(
			"Rows written · 7d",
		);
	});

	test("no What's happening box without an insight", () => {
		expect(render()).not.toContain("What&#x27;s happening");
	});

	test("a stopped subgraph says so and shows what is happening with its error", () => {
		const html = failing();
		expect(html).toContain("Stopped at block 9,218,411");
		expect(html).toContain("What&#x27;s happening");
		expect(html).toContain("Cannot read properties of null");
		expect(html).toContain("Copy the fix as a prompt");
		expect(html).not.toContain(">Send a test<");
		expect(html).not.toContain("Requeue");
	});
});
