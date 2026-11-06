import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { linkify } from "./block-checker";

describe("linkify", () => {
	const html = (text: string, links: { match: string; href: string }[]) =>
		renderToStaticMarkup(<p>{linkify(text, links)}</p>);

	test("wraps the matched hash in an external link and keeps the rest as text", () => {
		expect(
			html("9,137,005  abc123", [
				{ match: "abc123", href: "https://x.test/a" },
			]),
		).toBe(
			'<p>9,137,005  <a href="https://x.test/a" target="_blank" rel="noopener noreferrer">abc123</a></p>',
		);
	});

	test("renders plain text when the match is not in the text", () => {
		expect(
			html("nothing here", [{ match: "abc", href: "https://x.test" }]),
		).toBe("<p>nothing here</p>");
	});

	test("links each match once, in text order", () => {
		const out = html("Stacks 1, Bitcoin 2", [
			{ match: "Bitcoin 2", href: "https://b.test" },
			{ match: "Stacks 1", href: "https://s.test" },
		]);
		expect(out.indexOf("https://s.test")).toBeLessThan(
			out.indexOf("https://b.test"),
		);
	});
});
