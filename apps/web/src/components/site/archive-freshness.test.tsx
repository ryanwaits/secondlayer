import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchiveFreshnessView } from "./archive-freshness";

const base = {
	toBlock: 9_137_864,
	promotedAt: "2026-10-07T10:17:49.516Z",
	state: "lagging",
	nextPublishAt: "2026-10-18T08:00:00.000Z" as string | null,
	behind: 89_085 as number | null,
};
const view = (over: Partial<typeof base>) =>
	renderToStaticMarkup(<ArchiveFreshnessView {...base} {...over} />);

describe("ArchiveFreshnessView", () => {
	test("lagging says how far the chain is past it and when the next publish is", () => {
		const html = view({});
		expect(html).toContain("Signed through <b>#9,137,864</b> on Oct 7.");
		expect(html).toContain("blocks past it; the next publish is");
		expect(html).toContain("Sun Oct 18, 08:00 UTC");
		expect(html).not.toContain("fresh-dot");
	});

	test("without next_publish_at the clause is dropped and the sentence ends", () => {
		const html = view({ nextPublishAt: null });
		expect(html).toContain("blocks past it.");
		expect(html).not.toContain("next publish");
	});

	test("stale shows the dot and overdue since the first missed run", () => {
		const html = view({
			state: "stale",
			promotedAt: "2026-10-07T10:17:49.516Z",
		});
		expect(html).toContain("fresh-dot");
		expect(html).toContain("the next publish is overdue</b> since Oct 11");
		expect(html).not.toContain("Sun Oct 18");
	});

	test.each(["gap", "failed-audit", "source-unavailable", "unknown"])(
		"%s says only what the signed copy reaches",
		(state) => {
			const html = view({ state });
			expect(html).toContain("Signed through");
			expect(html).not.toContain("blocks past it");
			expect(html).not.toContain("next publish");
		},
	);

	test("an unknown tip leaves out the chain clause but keeps the next publish", () => {
		const html = view({ behind: null });
		expect(html).not.toContain("blocks past it");
		expect(html).toContain("The next publish is");
	});
});
