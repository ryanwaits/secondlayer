import { describe, expect, test } from "bun:test";
import {
	extractAgentNotes,
	mdxToMarkdown,
	readAllDocsMarkdown,
} from "./docs-source";

describe("extractAgentNotes", () => {
	test("pulls a multi-line block with blank lines and removes it entirely", () => {
		const source = [
			"# Title",
			"",
			"export const agent = `",
			"- first rule",
			"",
			"- second rule",
			"`;",
			"",
			"export const metadata = { title: 'x' };",
			"",
			"Body.",
		].join("\n");
		const { notes, rest } = extractAgentNotes(source);
		expect(notes).toBe("- first rule\n\n- second rule");
		expect(rest).not.toContain("export const agent");
		expect(rest).not.toContain("second rule");
		expect(rest).toContain("Body.");
	});

	test("returns null notes and untouched source when there is no block", () => {
		const source = "# Title\n\nBody.\n";
		expect(extractAgentNotes(source)).toEqual({ notes: null, rest: source });
	});
});

describe("mdxToMarkdown", () => {
	test("turns multi-line details into a heading with no html left", () => {
		const md = mdxToMarkdown(
			[
				'<details id="options">',
				"<summary>Options</summary>",
				"",
				"Body text.",
				"",
				"</details>",
			].join("\n"),
		);
		expect(md).toContain("### Options");
		expect(md).toContain("Body text.");
		expect(md).not.toContain("<details");
		expect(md).not.toContain("<summary");
	});
});

describe("readAllDocsMarkdown", () => {
	test("includes the shared setup section exactly once", async () => {
		const all = await readAllDocsMarkdown();
		expect(all.match(/^## Setup$/gm)?.length).toBe(1);
	});
});
