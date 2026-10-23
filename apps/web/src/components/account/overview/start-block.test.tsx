import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StartBlock } from "./start-block";

describe("StartBlock", () => {
	const html = renderToStaticMarkup(<StartBlock />);

	test("names both options with their --help commands", () => {
		expect(html).toContain("Webhooks and subgraphs");
		expect(html).toContain("Want chain events pushed to you? Webhooks");
		expect(html).toContain("Want your own tables to query? Subgraphs");
		expect(html).toContain("sl webhooks create --help");
		expect(html).toContain("sl subgraphs create --help");
	});

	test("says where each one will show up, and never mentions an agent", () => {
		expect(html).toContain(
			"Each one shows up here, with its own row and chart, once it exists.",
		);
		expect(html.toLowerCase()).not.toContain("your agent");
	});
});
