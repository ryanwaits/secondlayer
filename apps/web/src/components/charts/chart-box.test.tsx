import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartBox } from "./chart-skeleton";

describe("ChartBox", () => {
	test("holds its height and shows the loading skeleton when it has no chart yet", () => {
		const html = renderToStaticMarkup(<ChartBox height={170} />);
		expect(html).toContain("height:170px");
		expect(html).toContain("dc-chart-box");
		expect(html).toContain("wh-skel");
	});

	test("shows the chart instead of the skeleton once there is one", () => {
		const html = renderToStaticMarkup(
			<ChartBox height={120}>
				<svg data-chart="x" />
			</ChartBox>,
		);
		expect(html).toContain("height:120px");
		expect(html).toContain('data-chart="x"');
		expect(html).not.toContain("wh-skel");
	});
});
