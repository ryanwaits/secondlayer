import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { tableCode } from "./describe-table";
import { SubgraphDetailBody } from "./detail-screen";
import { SubgraphsEmptyState } from "./empty-state";
import { HandlerErrorsPanel } from "./health-panels";
import { SubgraphRows, SubgraphsListBody } from "./list-screen";
import { RecentRowsBody, RowPayload } from "./recent-rows";
import {
	EXAMPLE_NOW,
	PERF_TEST_SBTC_ROWS,
	PERF_TEST_SBTC_SOURCE,
	exampleErrors,
	exampleHealth,
	exampleList,
	perfTestSbtcDetail,
} from "./subgraph.fixtures";
import {
	TableDetails,
	TablesSection,
	detailsAfter,
	frozenOrder,
} from "./tables-section";
import { UseSection } from "./use-section";

describe("SubgraphsEmptyState", () => {
	test("says what a subgraph is, shows the deploy command and links the guide", () => {
		const html = renderToStaticMarkup(<SubgraphsEmptyState />);
		expect(html).toContain("No subgraphs yet.");
		expect(html).toContain("sl subgraphs deploy ./subgraphs/&lt;name&gt;.ts");
		expect(html).toContain('href="/docs/subgraphs"');
		expect(html).toContain("Subgraphs guide");
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

/** Seven days of hourly health, oldest first, with errors in the last day. */
function weekOf(errors24h: number) {
	const day = exampleHealth(errors24h).hours;
	const hours = Array.from({ length: 168 }, (_, i) => ({
		...day[i % 24],
		hour: new Date(EXAMPLE_NOW - (167 - i) * 3_600_000).toISOString(),
		errors: i === 150 ? errors24h : 0,
	}));
	return { hours, errors24h };
}
const weekHealth = {
	"sbtc-deposits": weekOf(2),
	"vault-events": weekOf(3),
};

describe("SubgraphsListBody", () => {
	const health = {
		"sbtc-deposits": exampleHealth(0),
		"vault-events": exampleHealth(3),
	};

	test("one row per subgraph with its numbers and links", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain('href="/account/subgraphs/sbtc-deposits"');
		expect(html).toContain("<strong>443,957</strong><small>rows</small>");
		expect(html).toContain("<small>since the last write</small>");
		expect(html).not.toContain("Everything is indexing.");
	});

	test("a healthy row has no status; lag reads as progress, never behind", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={{ "sbtc-deposits": exampleHealth(0) }}
				notice={null}
			/>,
		);
		expect(html).not.toContain("At the tip");
		expect(html).not.toContain("Behind");
		expect(html.match(/class="ix-chip/g)).toHaveLength(1);
		expect(html).toContain("Catching up · 112 blocks to go");
	});

	test("handler errors are the why line and the row fails", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain("3 handler errors in 24h");
		expect(html).toContain("Failing</span>");
	});

	test("a big title and one clickable row per subgraph", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain("<h1>Subgraphs</h1>");
		expect(html.match(/class="ix-row"/g)).toHaveLength(exampleList.length);
		expect(html).toContain("2 tables");
		expect(html).toContain("1 table<");
	});

	test("a row with a week of health draws the heat grid", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={weekHealth}
				notice={null}
			/>,
		);
		expect(html).toContain(
			'aria-label="sbtc-deposits, rows written per hour, last 7 days"',
		);
		expect(html).toContain('class="dc-heat"');
		expect(html).toContain("dc-heat-cell f");
		expect(html).toContain("rows written");
		expect(html).toContain("handler errors");
		expect(html).not.toContain("delivered");
	});

	test("a row without health holds the grid's space with the skeleton", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={{}} notice={null} />,
		);
		expect(html).toContain("dc-heat-cell s");
		expect(html).not.toContain("last 7 days");
	});

	test("the key explains the grid", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain("Less");
		expect(html).toContain("More");
		expect(html).toContain("Handler failed");
		expect(html).toContain("None");
		expect(html).not.toContain("Rows written that hour, darker is more");
	});

	test("every strip sits on the newest hour any subgraph reports", () => {
		const lagging = weekOf(0);
		const shifted = {
			...lagging,
			hours: lagging.hours.map((h) => ({
				...h,
				hour: new Date(Date.parse(h.hour) - 3 * 3_600_000).toISOString(),
			})),
		};
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={{ "sbtc-deposits": weekOf(0), "vault-events": shifted }}
				notice={null}
				initialView="ribbon"
			/>,
		);
		expect(html.match(/class="ix-cell/g)).toHaveLength(168 * 2);
	});

	test("three subgraphs show no search, four do", () => {
		const copy = (name: string) => ({ ...exampleList[0], name });
		const three = [copy("a"), copy("b"), copy("c")] as typeof exampleList;
		const four = [...three, copy("d")] as typeof exampleList;
		const render = (items: typeof exampleList) =>
			renderToStaticMarkup(
				<SubgraphsListBody items={items} health={{}} notice={null} />,
			);
		expect(render(three)).not.toContain('id="index-q"');
		expect(render(four)).toContain('id="index-q"');
	});

	test("Ribbon draws strips with no buttons in them", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody
				items={exampleList}
				health={weekHealth}
				notice={null}
				initialView="ribbon"
			/>,
		);
		expect(html).toContain("ix-ribbon");
		expect(html).not.toContain("dc-heat-cell");
		expect(html.match(/<button[^>]*ix-cell/g)).toBeNull();
	});

	test("the Overview's rows keep a 24-point sparkline given a week of health", () => {
		const html = renderToStaticMarkup(
			<SubgraphRows items={exampleList} health={weekHealth} />,
		);
		expect(html).toContain("rows written per hour, last 24 hours");
		const path =
			html.match(/class="dc-stroke-[a-z]+"[^>]*d="([^"]+)"/)?.[1] ?? "";
		expect(path.match(/[ML]/g)).toHaveLength(24);
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

const sbtcSource = {
	name: "perf-test-sbtc",
	version: "1.0.0",
	sourceCode: PERF_TEST_SBTC_SOURCE,
	readOnly: false,
	updatedAt: "2026-11-03T19:50:00Z",
};

function tablesSection(source: typeof sbtcSource | null) {
	return renderToStaticMarkup(
		<TablesSection
			name="perf-test-sbtc"
			tables={perfTestSbtcDetail.tables}
			sources={perfTestSbtcDetail.sources}
			source={source}
		/>,
	);
}

describe("TablesSection", () => {
	const table = (rowCount: number) => ({
		endpoint: "/v1/subgraphs/x/t",
		rowCount,
		columns: {},
	});

	test("renders every table as a closed card, biggest first, with no estimate sign", () => {
		const html = tablesSection(sbtcSource);
		expect(html.match(/class="tc-card"/g)).toHaveLength(5);
		const names = [...html.matchAll(/class="tc-name">([^<]+)</g)].map(
			(m) => m[1],
		);
		expect(names).toEqual([
			"completed_deposit",
			"withdrawal_create",
			"withdrawal_accept",
			"withdrawal_reject",
			"key_rotation",
		]);
		expect(html).toContain("5 tables");
		expect(html).not.toContain('aria-expanded="true"');
		expect(html).not.toContain("≈");
		expect(html).not.toContain("Rows from");
		expect(html).not.toContain("lf-pager");
	});

	test("cards keep their order when counts swap within the same version", () => {
		const render = (a: number, b: number) =>
			renderToStaticMarkup(
				<TablesSection
					name="x"
					tables={{ a: table(a), b: table(b) }}
					sources={undefined}
					source={null}
				/>,
			);
		const names = (html: string) =>
			[...html.matchAll(/class="tc-name">([^<]+)</g)].map((m) => m[1]);
		expect(names(render(10, 5))).toEqual(["a", "b"]);
		expect(names(render(5, 10))).toEqual(["b", "a"]);
		const first = frozenOrder(null, { a: table(10), b: table(5) });
		expect(frozenOrder(first, { a: table(5), b: table(10) })).toEqual([
			"a",
			"b",
		]);
	});

	test("a table that appears after the order was set goes last, a removed one drops out", () => {
		expect(
			frozenOrder(["a", "b"], { b: table(1), c: table(99), d: table(5) }),
		).toEqual(["b", "c", "d"]);
	});

	test("details open after the last card of the open card's grid row", () => {
		expect(detailsAfter(0, 3, 5)).toBe(2);
		expect(detailsAfter(4, 3, 5)).toBe(4);
		expect(detailsAfter(1, 2, 5)).toBe(1);
		expect(detailsAfter(0, 1, 5)).toBe(0);
	});

	test("the details panel keeps the sentence, its focus links and the handler source", () => {
		const { descriptions } = tableCode({
			name: "perf-test-sbtc",
			tables: perfTestSbtcDetail.tables,
			sources: perfTestSbtcDetail.sources,
			sourceCode: PERF_TEST_SBTC_SOURCE,
		});
		const html = renderToStaticMarkup(
			<TableDetails
				description={descriptions[0]?.description}
				block={undefined}
			/>,
		);
		expect(html).toContain('data-focus="event"');
		expect(html).toContain('data-focus="columns"');
		expect(html).toContain("6 columns copied from the event");
		expect(html).toContain('class="lf-pre"');
		expect(html).toContain("data-scope");
	});

	test("closed cards render no details, prose or code", () => {
		const html = tablesSection(sbtcSource);
		expect(html).not.toContain("lf-det");
		expect(html).not.toContain("data-focus");
		expect(html).not.toContain("lf-pre");
	});

	test("without a source the cards still render", () => {
		const html = tablesSection(null);
		expect(html.match(/class="tc-card"/g)).toHaveLength(5);
		expect(html).not.toContain("lf-pre");
	});
});

describe("RecentRowsBody", () => {
	const rows = Object.entries(PERF_TEST_SBTC_ROWS)
		.flatMap(([table, list]) => list.map((row) => ({ table, row })))
		.slice(0, 3);

	test("lists each row, newest block first", () => {
		const html = renderToStaticMarkup(
			<RecentRowsBody name="perf-test-sbtc" rows={rows} />,
		);
		expect(html.match(/<tr class="click"/g)).toHaveLength(3);
		const blocks = [...html.matchAll(/<td>#([\d,]+)<\/td>/g)].map((m) =>
			Number((m[1] ?? "").replace(/,/g, "")),
		);
		expect(blocks).toEqual([...blocks].sort((a, b) => b - a));
		expect(html).not.toContain("click a row");
	});

	test("shows skeleton rows while loading", () => {
		const html = renderToStaticMarkup(
			<RecentRowsBody name="perf-test-sbtc" rows={null} />,
		);
		expect(html.match(/wh-skel/g)).toHaveLength(5);
		expect(html).not.toContain('class="click"');
	});

	test("says so when no row has been written", () => {
		const html = renderToStaticMarkup(
			<RecentRowsBody name="perf-test-sbtc" rows={[]} />,
		);
		expect(html).toContain("No rows yet.");
	});
});

describe("RowPayload", () => {
	const row = {
		_id: "4817",
		_block_height: "9406147",
		_tx_id:
			"0x28b38a37ec1c0a2913ff5e0051fdfc5038ead96e90b6f5d7b05f4bc0d3de3e45",
		_created_at: "2026-11-03T19:49:38.682Z",
		request_id: "4817",
		signer_bitmap: "255",
	};
	const html = renderToStaticMarkup(
		<RowPayload name="perf-test-sbtc" table="withdrawal_reject" row={row} />,
	);

	test("an opened row shows its own columns as Fields, without system columns", () => {
		const fields = html.slice(html.indexOf('<dl class="pv-fields">'));
		expect(fields).toContain("<dt>request_id</dt>");
		expect(fields).toContain("<dd>255</dd>");
		expect(fields).not.toContain("_block_height");
		expect(fields).not.toContain("_tx_id");
	});

	test("the bar offers Fields and JSON, with no Query tab or attempts line", () => {
		expect(html).toContain("Fields");
		expect(html).toContain("JSON");
		expect(html).not.toContain("Query");
		expect(html).not.toContain("ins-timeline");
	});

	test("the bar names the block and links the transaction", () => {
		expect(html).toContain("Block 9,406,147");
		expect(html).toContain("explorer.hiro.so/txid/0x28b38a37");
	});
});

describe("UseSection", () => {
	const tables = {
		withdrawal_reject: {
			endpoint: "/v1/subgraphs/perf-test-sbtc/withdrawal_reject",
			rowCount: 295,
			columns: {
				request_id: { type: "uint" },
				signer_bitmap: { type: "uint" },
			},
		},
		completed_deposit: {
			endpoint: "/v1/subgraphs/perf-test-sbtc/completed_deposit",
			rowCount: 64_023,
			columns: { amount: { type: "uint" }, burn_hash: { type: "text" } },
		},
		withdrawal_create: {
			endpoint: "/v1/subgraphs/perf-test-sbtc/withdrawal_create",
			rowCount: 4_828,
			columns: { amount: { type: "uint" }, sender: { type: "principal" } },
		},
	};
	const html = renderToStaticMarkup(
		<UseSection name="perf-test-sbtc" tables={tables} />,
	);

	test("a chip per table, the biggest table first and selected", () => {
		const chips = [
			...html.matchAll(
				/<button type="button" aria-pressed="(true|false)">([a-z_]+)<\/button>/g,
			),
		]
			.map((m) => m[2])
			.filter((label) => label?.includes("_"));
		expect(chips).toEqual([
			"completed_deposit",
			"withdrawal_create",
			"withdrawal_reject",
		]);
		expect(html).toContain('aria-pressed="true">completed_deposit<');
	});

	test("SDK is the selected tab and Newest the selected recipe", () => {
		expect(html).toContain('role="tab" aria-selected="true">SDK<');
		expect(html).toContain('role="tab" aria-selected="false">CLI<');
		expect(html).toContain('aria-pressed="true">Newest<');
	});

	test("the plain code shows in the rendered frame's layout until it arrives, without tip lines", () => {
		const body = html.slice(html.indexOf('class="use-body"'));
		expect(body).toContain(
			'<div class="cb tabbed"><div class="cb-body"><div class="row">',
		);
		expect(body).toContain("getSubgraph(definition)");
		expect(body).toContain(".completed_deposit.findMany(");
		expect(body).not.toContain("!tip");
		expect(body).not.toContain("lf-pre");
	});

	test("Copy carries no hover caption", () => {
		expect(html).toContain(">Copy</button>");
		expect(html).not.toContain('role="tooltip"');
		expect(html).not.toContain("title=");
	});

	test("a table picked in the Tables section is the pressed chip", () => {
		const picked = renderToStaticMarkup(
			<UseSection
				name="perf-test-sbtc"
				tables={tables}
				selected="withdrawal_reject"
			/>,
		);
		expect(picked).toContain('aria-pressed="true">withdrawal_reject<');
		expect(picked).toContain('aria-pressed="false">completed_deposit<');
	});

	test("the chips carry the dashboard chip style", () => {
		expect(html).toContain('class="picker use-chips"');
	});

	test("a subgraph with no tables shows nothing", () => {
		expect(
			renderToStaticMarkup(<UseSection name="perf-test-sbtc" tables={{}} />),
		).toBe("");
	});
});

describe("SubgraphDetailBody", () => {
	const html = renderToStaticMarkup(
		<SubgraphDetailBody
			detail={perfTestSbtcDetail}
			health={exampleHealth()}
			errors={[]}
			source={sbtcSource}
			range="7d"
			onRange={() => {}}
		/>,
	);

	test("reads like the webhook page: tables, recent rows, no grid, tabs or schema", () => {
		expect(html).toContain('aria-label="Tables"');
		expect(html).toContain('aria-label="Recent rows"');
		expect(html).not.toContain("sg-tabs");
		expect(html).not.toContain("Blocks behind");
		expect(html).not.toContain("Schema");
	});

	test("facts follow the range and name the source contract", () => {
		expect(html).toContain("Rows written · 7d");
		expect(html).toContain("Handler errors · 7d");
		expect(html).toContain("sbtc-registry");
	});

	const renderWith = (
		detail: typeof perfTestSbtcDetail,
		health: ReturnType<typeof exampleHealth>,
	) =>
		renderToStaticMarkup(
			<SubgraphDetailBody
				detail={detail}
				health={health}
				errors={[]}
				source={sbtcSource}
				range="7d"
				onRange={() => {}}
			/>,
		);

	test("handler errors are marked failing only when there are some", () => {
		expect(html).not.toContain("dash-mark");
		expect(renderWith(perfTestSbtcDetail, exampleHealth(3))).toContain(
			'<span class="dash-mark fail">3</span>',
		);
	});

	test("behind tip is marked as attention only for an active subgraph that is not live", () => {
		const behind = (status: string, blocksRemaining: number) => ({
			...perfTestSbtcDetail,
			status,
			sync: { ...perfTestSbtcDetail.sync, blocksRemaining },
		});
		expect(renderWith(behind("active", 1240), exampleHealth())).toContain(
			'<span class="dash-mark att">',
		);
		expect(renderWith(behind("active", 0), exampleHealth())).not.toContain(
			"dash-mark att",
		);
		expect(
			renderWith(behind("reindexing", 1240), exampleHealth()),
		).not.toContain("dash-mark att");
	});

	test("the title carries no status dot", () => {
		expect(html).not.toContain("-dot");
	});
});
