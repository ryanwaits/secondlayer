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

	test("Keys sits between Subgraphs and Billing", () => {
		const html = renderToStaticMarkup(<DashboardTabs pathname="/account" />);
		const at = (href: string) => html.indexOf(`href="${href}"`);
		expect(at("/account/subgraphs")).toBeGreaterThan(-1);
		expect(at("/account/keys")).toBeGreaterThan(at("/account/subgraphs"));
		expect(at("/account/credits")).toBeGreaterThan(at("/account/keys"));
	});

	test("Keys is current on the Keys page", () => {
		const html = renderToStaticMarkup(
			<DashboardTabs pathname="/account/keys" />,
		);
		expect(html).toMatch(/aria-current="page"[^>]*href="\/account\/keys"/);
	});

	test("Subgraphs stays current on a subgraph's own page", () => {
		const html = renderToStaticMarkup(
			<DashboardTabs pathname="/account/subgraphs/vault-events" />,
		);
		expect(html).toMatch(/aria-current="page"[^>]*href="\/account\/subgraphs"/);
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
