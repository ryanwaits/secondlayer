import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockChecker } from "./block-checker";

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
