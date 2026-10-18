import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { ShareFixBody } from "./share-fix-sheet";

const insight = FIXTURE_INSIGHTS.find((i) => i.rule === "receiver_down");
if (!insight) throw new Error("missing fixture");
const html = renderToStaticMarkup(<ShareFixBody insight={insight} />);

describe("ShareFixBody", () => {
	test("links Claude, ChatGPT and Cursor to their pre-filled URLs", () => {
		expect(html).toContain('href="https://claude.ai/new?q=');
		expect(html).toContain('href="https://chatgpt.com/?q=');
		expect(html).toContain('href="https://cursor.com/link/prompt?text=');
	});

	test("offers exactly the four locked destinations and Copy", () => {
		for (const label of ["Claude", "ChatGPT", "Cursor", "Slack", "Copy"]) {
			expect(html).toContain(label);
		}
		for (const other of ["Notes", "Mail", "Messages"]) {
			expect(html).not.toContain(other);
		}
	});

	test("says what opening does", () => {
		expect(html).toContain(
			"Claude, ChatGPT and Cursor open with this filled in. You read it, then send.",
		);
	});
});
