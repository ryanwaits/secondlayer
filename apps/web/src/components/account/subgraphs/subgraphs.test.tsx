import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { SubgraphsEmptyState } from "./empty-state";
import { HandlerErrorsPanel } from "./health-panels";
import { SubgraphsListBody } from "./list-screen";
import { SchemaView } from "./schema-view";
import {
	EXAMPLE_NOW,
	exampleDetail,
	exampleErrors,
	exampleHealth,
	exampleList,
} from "./subgraph.fixtures";

describe("SubgraphsEmptyState", () => {
	test("says what a subgraph is, shows the deploy command and links the guide", () => {
		const html = renderToStaticMarkup(<SubgraphsEmptyState />);
		expect(html).toContain("No subgraphs yet.");
		expect(html).toContain("sl subgraphs deploy ./subgraphs/&lt;name&gt;.ts");
		expect(html).toContain('href="/docs/subgraphs"');
		expect(html).toContain("Subgraphs guide");
	});
});

describe("SchemaView", () => {
	const table = exampleDetail.tables.transfers;
	const html = table ? renderToStaticMarkup(<SchemaView table={table} />) : "";

	test("marks system columns as added by secondlayer", () => {
		expect(html).toMatch(/_tx_id<\/td>.*?added by secondlayer/);
	});

	test("marks nullable columns and indexed ones", () => {
		expect(html).toMatch(/sender<\/td>.*?nullable/);
		expect(html).toMatch(/recipient<\/td>.*?yes/);
		expect(html).toMatch(
			/amount<\/td><td><span class="sg-v sub">uint<\/span><\/td><td><span class="sg-v faint">no/,
		);
	});

	test("renders no insight area when there are none", () => {
		expect(html).not.toContain("insight");
	});
});

describe("SubgraphsListBody insights", () => {
	const handler = FIXTURE_INSIGHTS.find((i) => i.rule === "handler_errors");
	const health = {
		"sbtc-deposits": exampleHealth(0),
		"vault-events": exampleHealth(3),
	};

	test("a subgraph's worst insight replaces its state line", () => {
		if (!handler) throw new Error("missing fixture");
		const named = {
			...handler,
			resource: { ...handler.resource, id: "vault-events" },
		};
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={health}
				notice={null}
				insights={[named]}
			/>,
		);
		expect(html).toContain(named.line);
		expect(html).toContain("Why ›");
		expect(html).not.toContain("Behind tip 112 blocks");
	});

	test("an insight about another subgraph changes nothing", () => {
		if (!handler) throw new Error("missing fixture");
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={health}
				notice={null}
				insights={[handler]}
			/>,
		);
		expect(html).not.toContain(handler.line);
	});
});

describe("SubgraphsListBody", () => {
	const health = {
		"sbtc-deposits": exampleHealth(0),
		"vault-events": exampleHealth(3),
	};

	test("one row per subgraph with the state line and links", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain('href="/account/subgraphs/sbtc-deposits"');
		expect(html).toContain("At the tip · 443,957 rows · 0 errors 24h");
		expect(html).toContain("Behind tip 112 blocks · 1,204 rows · 3 errors 24h");
		expect(html).toContain("1 subgraph needs attention.");
	});

	test("an empty list shows the empty state", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={[]} health={{}} notice={null} />,
		);
		expect(html).toContain("No subgraphs yet.");
	});

	test("a starting stack is a sentence, not an error", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={null}
				health={{}}
				notice={{ kind: "starting" }}
			/>,
		);
		expect(html).toContain("Starting your hosted stack.");
	});
});

describe("HandlerErrorsPanel", () => {
	test("lists groups seen in the last 24 hours", () => {
		const html = renderToStaticMarkup(
			<HandlerErrorsPanel groups={exampleErrors} now={EXAMPLE_NOW} />,
		);
		expect(html).toContain("Handler errors · 24h");
		expect(html).toContain("handlers.ts:41");
		expect(html).toContain("ft_burn");
	});

	test("shows nothing for groups older than a day", () => {
		const html = renderToStaticMarkup(
			<HandlerErrorsPanel
				groups={exampleErrors}
				now={EXAMPLE_NOW + 3 * 86_400_000}
			/>,
		);
		expect(html).toBe("");
	});
});

describe("SubgraphsEmptyState for a new account", () => {
	test("the empty state never mentions keys", () => {
		const html = renderToStaticMarkup(<SubgraphsEmptyState />);
		expect(html).toContain("sl subgraphs deploy");
		expect(html).not.toContain("Reads need a key");
		expect(html).not.toContain("No active key");
		expect(html).not.toContain("You need a key");
	});
});

describe("SubgraphsListBody before health lands", () => {
	test("says it is checking rather than claiming everything is indexing", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={{}} notice={null} />,
		);
		expect(html).toContain("Checking your subgraphs.");
		expect(html).not.toContain("Everything is indexing.");
		expect(html).toContain('href="/account/subgraphs/sbtc-deposits"');
	});

	test("with health in, a subgraph with errors gets the attention sentence", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={{
					"sbtc-deposits": exampleHealth(0),
					"vault-events": exampleHealth(3),
				}}
				notice={null}
			/>,
		);
		expect(html).not.toContain("Checking your subgraphs.");
		expect(html).toContain("1 subgraph needs attention.");
	});
});

describe("SubgraphsListBody page insight", () => {
	const stack: Insight = {
		id: "ins_stack_unreachable_subgraphs",
		rule: "stack_unreachable_subgraphs",
		severity: "losing",
		impact: 3,
		resource: { kind: "account", id: "account", name: "Account" },
		line: "Subgraph queries did not reach your stack",
		lead: "Our fault, not yours.",
		body: "We couldn't reach the stack.",
		evidence: [],
		handoff: { prompt: "", commands: [] },
		how: { detector: "stack calls", facts: [] },
		createdAt: "2026-10-15T18:00:00.000Z",
	};

	test("shows the stack insight above the list", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={{}}
				notice={null}
				pageInsights={[stack]}
			/>,
		);
		expect(html).toContain(stack.line);
	});

	test("shows it when the list could not load", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={null}
				health={{}}
				notice={{ kind: "error", message: "boom" }}
				pageInsights={[stack]}
			/>,
		);
		expect(html).toContain(stack.line);
		expect(html).toContain("Couldn&#x27;t load your subgraphs.");
	});
});
