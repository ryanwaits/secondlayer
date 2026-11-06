import { describe, expect, test } from "bun:test";
import type { InsightEvidence } from "@/lib/insights";
import { renderToStaticMarkup } from "react-dom/server";
import { Evidence } from "./evidence";

describe("Evidence", () => {
	const render = (item: InsightEvidence) =>
		renderToStaticMarkup(<Evidence item={item} />);

	test("response shows what was sent, the escaped excerpt, then the timing", () => {
		const html = render({
			kind: "response",
			title: "What your endpoint sent back",
			sent: [
				["Status", "500"],
				["Type", "text/html"],
			],
			excerpt: "<script>alert(1)</script>",
			facts: [["Last success", "Oct 15 16:02 UTC"]],
		});
		expect(html).toContain("What your endpoint sent back");
		expect(html).toContain("Status <b>500</b>");
		expect(html).toContain('<pre class="ev-pre">&lt;script&gt;alert(1)');
		expect(html).not.toContain("<script>");
		expect(html.indexOf("Status")).toBeLessThan(html.indexOf("ev-pre"));
		expect(html.indexOf("ev-pre")).toBeLessThan(html.indexOf("Last success"));
	});
});
