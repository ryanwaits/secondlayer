import { describe, expect, test } from "bun:test";
import { buildPrompt } from "./docs-prompt";

const pageUrl = "https://secondlayer.tools/docs/streams.md";

describe("buildPrompt", () => {
	test("includes the page's agent notes under a rules heading when present", () => {
		const out = buildPrompt({
			task: "add a balances table",
			pageMd:
				"# Streams\n\nBody.\n\n## Notes for agents\n\n- return ctx.cursor\n- never poll",
			pageUrl,
		});
		expect(out).toContain(
			"Rules from these docs:\n- return ctx.cursor\n- never poll",
		);
		expect(out).toContain("Task: add a balances table");
		expect(out.startsWith("Ensure setup once")).toBe(true);
	});

	test("omits the rules heading when the page has no notes", () => {
		const out = buildPrompt({ task: "x", pageMd: "# Page\n\nBody.", pageUrl });
		expect(out).not.toContain("Rules from these docs");
	});

	test("stops the notes at the next section", () => {
		const out = buildPrompt({
			task: "x",
			pageMd: "## Notes for agents\n\n- a\n\n## Setup\n\nEnsure setup once",
			pageUrl,
		});
		expect(out).toContain("Rules from these docs:\n- a\n\nTask");
	});

	test("lists the page first and dedupes extra urls", () => {
		const out = buildPrompt({
			task: "x",
			pageMd: "",
			pageUrl,
			extraUrls: [pageUrl, "https://secondlayer.tools/docs/index.md"],
		});
		expect(out).toContain(
			`Read first:\n- ${pageUrl}\n- https://secondlayer.tools/docs/index.md`,
		);
		expect(out.split(pageUrl).length).toBe(2);
	});
});
