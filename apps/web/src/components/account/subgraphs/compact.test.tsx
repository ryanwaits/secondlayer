import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { SubgraphListItem } from "@/lib/subgraphs-store";
import { renderToStaticMarkup } from "react-dom/server";
import { SubgraphCompactDetail } from "./compact-detail";
import { SubgraphCompactRow } from "./compact-list";
import {
	exampleDetail,
	exampleErrors,
	exampleHealth,
	exampleList,
} from "./subgraph.fixtures";

const healthy = exampleList[0] as SubgraphListItem;
const noop = () => {};

const handlerErrors = FIXTURE_INSIGHTS.find(
	(i) => i.rule === "handler_errors",
) as Insight;
// Insights match a subgraph by resource id, which the list passes as its name.
const insightFor = (name: string, over: Partial<Insight> = {}): Insight => ({
	...handlerErrors,
	resource: { kind: "subgraph", id: name, name },
	...over,
});

describe("subgraph compact row", () => {
	test("on the Account page a row links to its page", () => {
		const html = renderToStaticMarkup(
			<SubgraphCompactRow
				item={healthy}
				health={undefined}
				insights={[]}
				href={`/account/subgraphs/${healthy.name}`}
			/>,
		);
		expect(html).toContain(`href="/account/subgraphs/${healthy.name}"`);
		expect(html).toContain(healthy.name);
	});

	test("a failing subgraph's name is flagged, not dotted", () => {
		const html = renderToStaticMarkup(
			<SubgraphCompactRow
				item={healthy}
				health={undefined}
				insights={[insightFor(healthy.name)]}
				onOpen={noop}
			/>,
		);
		expect(html).toContain("name-flag");
	});
});

describe("subgraph compact detail", () => {
	const render = (insights: Insight[] = []) =>
		renderToStaticMarkup(
			<SubgraphCompactDetail
				detail={exampleDetail}
				health={exampleHealth(0)}
				errors={exampleErrors}
				insights={insights}
			/>,
		);

	test("shows the facts, the tables and the newest row, with no query command", () => {
		const html = render();
		for (const label of ["Behind", "Rows", "Errors", "Storage"]) {
			expect(html).toContain(`>${label}<`);
		}
		for (const table of Object.keys(exampleDetail.tables)) {
			expect(html).toContain(table);
		}
		expect(html).toContain("Newest");
		expect(html).not.toContain("wh-cli");
		expect(html).not.toContain("sl subgraphs");
	});

	test("an open insight shows Share the fix instead of its commands", () => {
		const html = render([insightFor(exampleDetail.name)]);
		expect(html).toContain("Share the fix");
		expect(html).not.toContain("wh-cli");
		expect(html).not.toContain("Copy the fix as a prompt");
	});
});
