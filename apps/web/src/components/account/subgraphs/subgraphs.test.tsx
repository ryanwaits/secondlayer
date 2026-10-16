import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GridView, type GridViewProps } from "./data-grid";
import { SubgraphsEmptyState } from "./empty-state";
import { HandlerErrorsPanel } from "./health-panels";
import { SubgraphsListBody } from "./list-screen";
import { RowPanel } from "./row-panel";
import { SchemaView } from "./schema-view";
import {
	EXAMPLE_NOW,
	exampleColumns,
	exampleDetail,
	exampleErrors,
	exampleHealth,
	exampleList,
	exampleRows,
} from "./subgraph.fixtures";

const noop = () => {};

function grid(overrides: Partial<GridViewProps> = {}) {
	return renderToStaticMarkup(
		<GridView
			name="sbtc-deposits"
			table="transfers"
			columns={exampleColumns}
			rowCount={412_880}
			rows={exampleRows(3)}
			error={null}
			sort={{ column: "_block_height", order: "desc" }}
			filters={[]}
			live
			page={1}
			hasNext
			loading={false}
			fresh={new Set()}
			openKey={null}
			now={EXAMPLE_NOW}
			onSort={noop}
			onFilter={noop}
			onRemoveFilter={noop}
			onToggleRow={noop}
			onNext={noop}
			onNewest={noop}
			onRetry={noop}
			{...overrides}
		/>,
	);
}

describe("SubgraphsEmptyState", () => {
	test("says what a subgraph is, shows the deploy command and links the guide", () => {
		const html = renderToStaticMarkup(<SubgraphsEmptyState />);
		expect(html).toContain("No subgraphs yet.");
		expect(html).toContain("sl subgraphs deploy ./subgraphs/&lt;name&gt;.ts");
		expect(html).toContain('href="/docs/subgraphs"');
		expect(html).toContain("Subgraphs guide");
	});
});

describe("GridView", () => {
	test("each header shows the column name with its type under it", () => {
		const html = grid();
		expect(html).toContain("_block_height");
		expect(html).toMatch(/<small[^>]*>bigint<\/small>/);
		expect(html).toMatch(/<small[^>]*>principal<\/small>/);
	});

	test("columns run block height, own columns, tx id; ids and write times are hidden", () => {
		const html = grid();
		const heads = [...html.matchAll(/<th /g)].length;
		expect(heads).toBe(6);
		expect(html.indexOf("_block_height")).toBeLessThan(html.indexOf("kind"));
		expect(html.lastIndexOf("_tx_id")).toBeGreaterThan(html.indexOf("amount"));
		expect(html).not.toContain(">_created_at");
	});

	test("a uint column is right-aligned and a text column is not", () => {
		const html = grid();
		expect(html).toMatch(
			/<th class=" r"[^>]*aria-sort="none"><button[^>]*><span class="sg-colname">amount/,
		);
		expect(html).toMatch(
			/<th class=""[^>]*aria-sort="none"><button[^>]*><span class="sg-colname">kind/,
		);
	});

	test("the sorted column shows its arrow and aria-sort", () => {
		const html = grid();
		expect(html).toContain('aria-sort="descending"');
		expect(html).toContain("_block_height ↓");
	});

	test("a null cell reads as the faint word null", () => {
		const rows = [{ ...exampleRows(1)[0], sender: null }];
		expect(grid({ rows })).toContain('<span class="sg-v faint">null</span>');
	});

	test("principals are shortened with the full value in the title", () => {
		const rows = exampleRows(1);
		const sender = String(rows[0]?.sender ?? rows[0]?.recipient);
		const html = grid({ rows });
		expect(html).toContain(`title="${sender}"`);
		expect(html).toContain(`${sender.slice(0, 5)}…${sender.slice(-4)}`);
	});

	test("a filter shows as a chip and the footer counts matches", () => {
		const html = grid({
			filters: [{ column: "kind", value: "burn" }],
			live: true,
		});
		expect(html).toContain("kind = burn");
		expect(html).toContain("Showing the first 3 matches");
	});

	test("with no filters the hint and the newest-rows footer show", () => {
		const html = grid();
		expect(html).toContain("Open a row to filter by any of its values.");
		expect(html).toContain("412,880 rows · newest 3");
		expect(html).toContain("New rows land with each block");
		expect(html).toContain("Copy as SDK");
		expect(html).toContain("Next 25 ›");
	});

	test("Back to newest appears only once paged", () => {
		expect(grid()).not.toContain("Back to newest");
		expect(grid({ page: 2, live: false })).toContain("Back to newest");
	});

	test("a fresh row gets the new-row dot", () => {
		const rows = exampleRows(2);
		const html = grid({ rows, fresh: new Set([String(rows[0]?._id)]) });
		expect(html.match(/sg-slot new/g)).toHaveLength(1);
	});

	test("off the default sort the live note gives way to why", () => {
		const html = grid({
			sort: { column: "amount", order: "desc" },
			live: false,
		});
		expect(html).not.toContain("New rows land with each block");
		expect(html).toContain("Sorted by amount");
	});

	test("an empty table says so", () => {
		expect(grid({ rows: [] })).toContain("No rows yet.");
		expect(
			grid({ rows: [], filters: [{ column: "kind", value: "x" }] }),
		).toContain("No rows match these filters.");
	});
});

describe("RowPanel", () => {
	const row = exampleRows(1)[0] ?? {};
	const html = renderToStaticMarkup(
		<RowPanel
			row={row}
			columns={exampleColumns}
			now={EXAMPLE_NOW}
			onFilter={noop}
		/>,
	);

	test("shows where the row came from", () => {
		expect(html).toContain("Where it came from");
		expect(html).toContain("#9,218,411");
		expect(html).toContain("Written");
		expect(html).toContain(
			"Every row keeps the block and transaction it came from",
		);
	});

	test("offers Filter on values but not on _id or _created_at", () => {
		expect(html).toContain('aria-label="Filter by kind"');
		expect(html).not.toContain('aria-label="Filter by _id"');
		expect(html).not.toContain('aria-label="Filter by _created_at"');
	});

	test("lists every column, system ones included, and Copy as JSON", () => {
		expect(html).toContain("<dt>_id</dt>");
		expect(html).toContain("<dt>_created_at</dt>");
		expect(html).toContain("Copy as JSON");
	});

	test("a null value gets no Filter", () => {
		const nulled = renderToStaticMarkup(
			<RowPanel
				row={{ ...row, sender: null }}
				columns={exampleColumns}
				onFilter={noop}
			/>,
		);
		expect(nulled).not.toContain('aria-label="Filter by sender"');
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
