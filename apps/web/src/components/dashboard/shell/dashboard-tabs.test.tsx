import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTabs, isCurrent } from "./dashboard-tabs";

describe("DashboardTabs", () => {
	test("marks only the current tab", () => {
		const html = renderToStaticMarkup(
			<DashboardTabs pathname="/account/webhooks/wh_1" />,
		);
		expect(html.match(/aria-current="page"/g)).toHaveLength(1);
		expect(html).toMatch(/aria-current="page"[^>]*href="\/account\/webhooks"/);
	});

	test("omits tabs that are not ready", () => {
		const html = renderToStaticMarkup(<DashboardTabs pathname="/account" />);
		expect(html).toContain("/account/rows");
		expect(html).not.toContain("/account/subgraphs");
		expect(html).not.toContain("/account/keys");
	});

	test("Overview matches only exactly /account", () => {
		expect(isCurrent("/account", "/account")).toBe(true);
		expect(isCurrent("/account/webhooks", "/account")).toBe(false);
	});

	test("shows the badge only when webhooks are failing", () => {
		const none = renderToStaticMarkup(
			<DashboardTabs pathname="/account" failingWebhooks={0} />,
		);
		const some = renderToStaticMarkup(
			<DashboardTabs pathname="/account" failingWebhooks={2} />,
		);
		expect(none).not.toContain("dash-tab-n");
		expect(some).toContain("dash-tab-n");
		expect(some).toContain("2 failing");
	});
});
