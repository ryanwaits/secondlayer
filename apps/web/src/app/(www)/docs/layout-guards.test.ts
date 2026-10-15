import { describe, expect, test } from "bun:test";

const docsCss = await Bun.file(new URL("./docs.css", import.meta.url)).text();

describe("docs article width rules", () => {
	test("the figure margin rule skips keyed bare blocks, which keep the prose measure", () => {
		expect(docsCss).toContain(".docs-article > .cf:not(.key) {");
		expect(docsCss).not.toMatch(/\.docs-article > \.cf \{/);
		expect(docsCss).toMatch(
			/\.docs-article:has\(> \.cf\) > \.cf\.key \{\s*max-width: 720px;/,
		);
	});

	test("prose tables scroll inside a wrapper instead of widening the page", () => {
		expect(docsCss).toMatch(/\.docs-table \{[^}]*overflow-x: auto;/);
	});
});
