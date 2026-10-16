import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceRow, ResourceRowHead } from "./resource-row";

describe("ResourceRow", () => {
	test("links to the resource and renders all five cells", () => {
		const html = renderToStaticMarkup(
			<ResourceRow
				href="/account/webhooks/wh_1"
				name="sbtc-deposits"
				tone="alarm"
				state="Failing since 09:14"
				count="1,204"
				age="3m"
			/>,
		);
		expect(html).toContain('href="/account/webhooks/wh_1"');
		for (const cell of [
			"dash-row-name",
			"dash-row-state",
			"dash-row-spark",
			"dash-row-v",
			"dash-row-t",
		]) {
			expect(html).toContain(cell);
		}
		expect(html).toContain("dash-dot alarm");
		expect(html).toContain("sbtc-deposits");
	});

	test("a healthy row keeps an empty dot slot, not a green dot", () => {
		const row = (tone: "ok" | "alarm") =>
			renderToStaticMarkup(
				<ResourceRow href="/x" name="sbtc-deposits" tone={tone} />,
			);
		expect(row("ok")).toContain("dash-dot none");
		expect(row("ok")).not.toContain('class="dash-dot"');
		expect(row("alarm")).toContain("dash-dot alarm");
	});

	test("head renders the five labels", () => {
		const html = renderToStaticMarkup(
			<ResourceRowHead labels={["Name", "State", "", "Events", "Last"]} />,
		);
		expect(html).toContain("dash-row-head");
		expect(html).toContain("<span>Events</span>");
	});
});
