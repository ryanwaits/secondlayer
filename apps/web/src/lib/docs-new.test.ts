import { describe, expect, test } from "bun:test";
import docsNewPages from "@/generated/docs-new.json";
import { pageMarks } from "../../scripts/docs-new";
import { isFresh, pageNewDate, stampNewMarks } from "./docs-new.mjs";
import { mdxToMarkdown } from "./docs-source";
import remarkNewMarks from "./remark-new-marks.mjs";

const TODAY = "2026-10-15";

describe("isFresh", () => {
	const now = Date.parse(TODAY);
	test("a mark shows for 30 days from its date, then drops off", () => {
		expect(isFresh("2026-10-15", now)).toBe(true);
		expect(isFresh("2026-09-16", now)).toBe(true);
		expect(isFresh("2026-09-15", now)).toBe(false);
	});
	test("no mark, a bad date or a future date shows nothing", () => {
		expect(isFresh(undefined, now)).toBe(false);
		expect(isFresh("soon", now)).toBe(false);
		expect(isFresh("2026-10-16", now)).toBe(false);
	});
});

describe("stampNewMarks", () => {
	const before = "# Streams\n\nIntro.\n\n## Cursors\n\nText.\n";

	test("marks a section the commit adds, and only that one", () => {
		const after = `${before}\n## Runes\n\nNew text.\n`;
		expect(stampNewMarks(before, after, TODAY)).toBe(
			`${before}\n{/* new: 2026-10-15 */}\n## Runes\n\nNew text.\n`,
		);
	});

	test("an edit inside an existing section stamps nothing", () => {
		const after = before.replace("Text.", "Better text.");
		expect(stampNewMarks(before, after, TODAY)).toBe(after);
	});

	test("a renamed section is not new", () => {
		const after = before.replace("## Cursors", "## Cursors and reorgs");
		expect(stampNewMarks(before, after, TODAY)).toBe(after);
	});

	test("a section added after a rename is still new", () => {
		const after = `${before.replace("## Cursors", "## Paging")}\n## Runes\n`;
		expect(stampNewMarks(before, after, TODAY)).toBe(
			`${before.replace("## Cursors", "## Paging")}\n{/* new: 2026-10-15 */}\n## Runes\n`,
		);
	});

	test("a new page gets one mark on its title, not one per section", () => {
		expect(stampNewMarks(null, before, TODAY)).toBe(
			`{/* new: 2026-10-15 */}\n${before}`,
		);
	});

	test("stamping twice changes nothing the second time", () => {
		const once = stampNewMarks(before, `${before}\n## Runes\n`, TODAY);
		expect(stampNewMarks(before, once, TODAY)).toBe(once);
	});

	test("expired marks are removed, fresh ones kept", () => {
		const after =
			"{/* new: 2026-08-01 */}\n## Old\n\n{/* new: 2026-10-01 */}\n## Recent\n";
		expect(stampNewMarks(after, after, TODAY)).toBe(
			"## Old\n\n{/* new: 2026-10-01 */}\n## Recent\n",
		);
	});

	test("headings inside code fences are not sections", () => {
		const after = `${before}\n\`\`\`md\n## Not a section\n\`\`\`\n`;
		expect(stampNewMarks(before, after, TODAY)).toBe(after);
	});
});

test("pageNewDate reads the mark on the page title only", () => {
	expect(pageNewDate("{/* new: 2026-10-15 */}\n# Page\n")).toBe("2026-10-15");
	expect(pageNewDate("# Page\n\n{/* new: 2026-10-15 */}\n## Section\n")).toBe(
		null,
	);
});

test("remark-new-marks puts the mark's date on the heading after it", () => {
	const heading = { type: "heading", depth: 2, children: [] } as {
		type: string;
		data?: { hProperties?: Record<string, string> };
	};
	const tree = {
		children: [
			{ type: "mdxFlowExpression", value: "/* new: 2026-10-15 */" },
			heading,
		],
	};
	remarkNewMarks()(tree);
	expect(heading.data?.hProperties?.["data-new"]).toBe("2026-10-15");
});

test("the markdown twin leaves new marks out", () => {
	expect(mdxToMarkdown("{/* new: 2026-10-15 */}\n## Runes\n\nText.")).toBe(
		"## Runes\n\nText.",
	);
});

test("docs-new.json matches the page marks (run bun run docs:new)", () => {
	// Widened: the JSON's inferred literal keys would reject any other map.
	const pages: Record<string, string> = docsNewPages;
	expect(pages).toEqual(pageMarks());
});
