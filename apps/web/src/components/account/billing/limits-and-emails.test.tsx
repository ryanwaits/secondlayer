import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LimitsAndEmails } from "./limits-and-emails";

describe("LimitsAndEmails", () => {
	test("is the cap anchor that /account#cap scrolls to", () => {
		const html = renderToStaticMarkup(
			<LimitsAndEmails capUsd={null} onCapChange={() => {}} spentUsd={0} />,
		);
		expect(html).toContain('id="cap"');
	});
});
