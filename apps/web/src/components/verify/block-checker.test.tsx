import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockChecker, RerunHint, linkify } from "./block-checker";

describe("block checker", () => {
	const html = renderToStaticMarkup(<BlockChecker />);

	test("opens on a real block, ready to check", () => {
		expect(html).toContain('value="9137005"');
		expect(html).toContain('aria-label="Block height or index block hash"');
		expect(html).toContain(">Check</button>");
	});

	test("says it needs no key and sends no credentials", () => {
		expect(html).toContain("No key, no account.");
		expect(html.toLowerCase()).not.toContain("authorization");
	});
});

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

describe("rerun hint", () => {
	const text = (node: React.ReactElement) =>
		renderToStaticMarkup(node).replace(/<[^>]+>/g, "");

	test("at the checkpoint it shows the node command and no proofs-API note", () => {
		const out = text(<RerunHint target={9137005} below={false} />);
		expect(out).toContain(
			"bunx @secondlayer/cli verify block 9137005 --node http://&lt;your-node&gt;:20443",
		);
		expect(out).not.toContain("16 blocks");
	});

	test("below the checkpoint it drops --node and explains why", () => {
		const out = text(<RerunHint target={150000} below />);
		expect(out).toContain("bunx @secondlayer/cli verify block 150000A node");
		expect(out).not.toContain("--node");
		expect(out).toContain("more than 16 blocks back");
	});
});
