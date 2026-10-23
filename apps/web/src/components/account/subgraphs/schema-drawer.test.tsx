import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SchemaDrawerBody, httpQuery } from "./schema-drawer";
import { exampleDetail, exampleRows } from "./subgraph.fixtures";

const row = exampleRows(1)[0] ?? {};

const render = (
	over: Partial<Parameters<typeof SchemaDrawerBody>[0]> = {},
): string =>
	renderToStaticMarkup(
		<SchemaDrawerBody
			detail={exampleDetail}
			table="transfers"
			onTable={() => {}}
			newest={{ status: "ok", row }}
			{...over}
		/>,
	);

describe("SchemaDrawerBody", () => {
	test("lists the table's row count, columns and types", () => {
		const html = render();
		expect(html).toContain("transfers · 412,880 rows");
		expect(html).toContain("<td>recipient</td>");
		expect(html).toContain('<span class="sg-v sub">principal</span>');
		expect(html).toContain("added by secondlayer");
	});

	test("a table choice switches between the subgraph's tables", () => {
		const html = render();
		expect(html).toContain("legend");
		expect(html).toContain(">transfers<");
		expect(html).toContain(">holders<");
		expect(render({ table: "holders" })).toContain("holders · 31,077 rows");
	});

	test("the newest row renders as JSON", () => {
		const html = render();
		expect(html).toContain('<div class="j">');
		expect(html).toContain("kind");
	});

	test("loading shows a skeleton, an empty table says so", () => {
		expect(render({ newest: { status: "loading" } })).toContain("wh-skel");
		expect(render({ newest: { status: "ok", row: null } })).toContain(
			"No rows yet.",
		);
	});

	test("the query commands name the subgraph and table, newest first", () => {
		const html = render();
		expect(html).toContain(
			"sl subgraphs query sbtc-deposits transfers --sort _block_height --order desc",
		);
		expect(html).toContain(
			"GET https://api.secondlayer.tools/v1/subgraphs/sbtc-deposits/transfers?_sort=_block_height&amp;_order=desc&amp;_limit=10",
		);
	});

	test("source gives the version, created date and last block", () => {
		const html = render();
		expect(html).toContain("<dd>v3.0.0</dd>");
		expect(html).toContain("Block 9,218,411");
		expect(html).toContain("Sep 1, 2026");
	});
});

describe("httpQuery", () => {
	test("an absolute endpoint is used as given", () => {
		expect(httpQuery("https://x.dev/v1/subgraphs/a/t")).toBe(
			"GET https://x.dev/v1/subgraphs/a/t?_sort=_block_height&_order=desc&_limit=10",
		);
	});
});
