import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Mark } from "./mark";
import { StatusSentence } from "./status-sentence";

describe("StatusSentence", () => {
	test("renders the sentence without a status dot", () => {
		const html = renderToStaticMarkup(
			<StatusSentence>All healthy</StatusSentence>,
		);
		expect(html).toContain("All healthy");
		expect(html).not.toContain("-dot");
	});

	test("renders the sub-line only when given", () => {
		const without = renderToStaticMarkup(<StatusSentence>Fine</StatusSentence>);
		const withSub = renderToStaticMarkup(
			<StatusSentence sub="2 webhooks">Fine</StatusSentence>,
		);
		expect(without).not.toContain("dash-status-sub");
		expect(withSub).toContain("dash-status-sub");
	});
});

describe("Mark", () => {
	test("attention and failing carry their own class", () => {
		expect(renderToStaticMarkup(<Mark tone="att">3</Mark>)).toContain(
			"dash-mark att",
		);
		expect(renderToStaticMarkup(<Mark tone="fail">3</Mark>)).toContain(
			"dash-mark fail",
		);
	});
});
