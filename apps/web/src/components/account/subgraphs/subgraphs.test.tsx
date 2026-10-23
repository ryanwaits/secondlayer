import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HandlerErrorsPanel } from "./health-panels";
import { SchemaView } from "./schema-view";
import { EXAMPLE_NOW, exampleDetail, exampleErrors } from "./subgraph.fixtures";

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
