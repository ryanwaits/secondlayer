import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
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
import { TablesSection, pageWindow } from "./tables-section";
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

	test("one row per subgraph with the state line and links", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain('href="/account/subgraphs/sbtc-deposits"');
		expect(html).toContain("At the tip · 443,957 rows · 0 errors 24h");
		expect(html).toContain("Behind tip 112 blocks · 1,204 rows · 3 errors 24h");
		expect(html).not.toContain("Everything is indexing.");
	});

	test("a big title and one wl-row per subgraph", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain("<h1>Subgraphs</h1>");
		expect(html.match(/class="wl-row"/g)).toHaveLength(exampleList.length);
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

	test("the legend explains the grid", () => {
		const html = renderToStaticMarkup(
			<SubgraphsListBody items={exampleList} health={health} notice={null} />,
		);
		expect(html).toContain("Rows written that hour, darker is more");
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
	test("renders the first three tables as closed rows, biggest first", () => {
		const html = tablesSection(sbtcSource);
		expect(html.match(/class="lf-row"/g)).toHaveLength(3);
		const chips = [...html.matchAll(/class="lf-type">([^<]+)</g)].map(
			(m) => m[1],
		);
		expect(chips).toEqual([
			"completed_deposit",
			"withdrawal_create",
			"withdrawal_accept",
		]);
		expect(html).toContain("5 tables");
		expect(html).not.toContain('aria-expanded="true"');
	});

	test("more than three tables show a pager with Next and no Prev on page one", () => {
		const html = tablesSection(sbtcSource);
		expect(html).toContain("1–3 of 5");
		expect(html).toContain("Next ›");
		expect(html).not.toContain("‹ Prev");
	});

	test("three or fewer tables show no pager", () => {
		const [first, second, third] = Object.entries(perfTestSbtcDetail.tables);
		const html = renderToStaticMarkup(
			<TablesSection
				name="perf-test-sbtc"
				tables={Object.fromEntries(
					[first, second, third].filter((e) => e !== undefined),
				)}
				sources={perfTestSbtcDetail.sources}
				source={sbtcSource}
			/>,
		);
		expect(html.match(/class="lf-row"/g)).toHaveLength(3);
		expect(html).not.toContain("lf-pager");
	});

	test("page two covers rows 4 to 5 of 5 and clamps out-of-range pages", () => {
		expect(pageWindow(5, 0)).toEqual({
			pages: 2,
			current: 0,
			start: 0,
			end: 3,
		});
		expect(pageWindow(5, 1)).toEqual({
			pages: 2,
			current: 1,
			start: 3,
			end: 5,
		});
		expect(pageWindow(5, 9).current).toBe(1);
		expect(pageWindow(3, 0).pages).toBe(1);
		expect(pageWindow(0, 0)).toEqual({
			pages: 0,
			current: 0,
			start: 0,
			end: 0,
		});
	});

	test("says what the first table writes and how many rows it holds", () => {
		const html = tablesSection(sbtcSource);
		expect(html).toContain("Rows from");
		expect(html).toContain("<code>completed-deposit</code>");
		expect(html).toContain("prints · ≈63,194 rows");
	});

	test("prose phrases are focus links and the source sits under them", () => {
		const html = tablesSection(sbtcSource);
		expect(html).toContain('data-focus="event"');
		expect(html).toContain('data-focus="columns"');
		expect(html).toContain("6 columns copied from the event");
		expect(html).toContain('class="lf-pre"');
	});

	test("without a source the rows still render and no code does", () => {
		const html = tablesSection(null);
		expect(html.match(/class="lf-row"/g)).toHaveLength(3);
		expect(html).not.toContain("lf-pre");
		expect(html).not.toContain("data-focus");
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
		expect(html).toContain("click a row for its values");
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

	test("the plain code shows until the frame arrives, without tip lines", () => {
		const pre = html.slice(html.indexOf('<pre class="lf-pre">'));
		expect(pre).toContain("getSubgraph(definition)");
		expect(pre).toContain(".completed_deposit.findMany(");
		expect(pre).not.toContain("!tip");
	});

	test("Copy carries no hover caption", () => {
		expect(html).toContain(">Copy</button>");
		expect(html).not.toContain('role="tooltip"');
		expect(html).not.toContain("title=");
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
