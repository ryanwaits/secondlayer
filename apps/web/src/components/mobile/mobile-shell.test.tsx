import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { renderToStaticMarkup } from "react-dom/server";
import {
	MobileHeader,
	MobileTabBar,
	currentTab,
	mobileHeader,
	newInsightCount,
} from "./mobile-shell";

describe("currentTab", () => {
	test("Pulse is only exactly /account", () => {
		expect(currentTab("/account")).toBe("pulse");
	});
	test("a webhook's page keeps Webhooks current", () => {
		expect(currentTab("/account/webhooks/wh_1")).toBe("webhooks");
	});
	test("keys, rows and credits belong to Account", () => {
		expect(currentTab("/account/keys")).toBe("account");
		expect(currentTab("/account/rows")).toBe("account");
		expect(currentTab("/account/credits")).toBe("account");
	});
	test("a prefix must end at a path boundary", () => {
		expect(currentTab("/account/subgraphsx")).toBeNull();
		expect(currentTab("/account/accountx")).toBeNull();
	});
});

describe("mobileHeader", () => {
	test("a webhook detail goes back to Webhooks", () => {
		expect(mobileHeader("/account/webhooks/wh_1")).toEqual({
			kind: "back",
			label: "Webhooks",
			href: "/account/webhooks",
		});
	});
	test("a subgraph detail goes back to Subgraphs", () => {
		expect(mobileHeader("/account/subgraphs/vault")).toEqual({
			kind: "back",
			label: "Subgraphs",
			href: "/account/subgraphs",
		});
	});
	test("Account paths are titled Account", () => {
		expect(mobileHeader("/account/credits")).toEqual({
			kind: "title",
			title: "Account",
		});
	});
	test("/account is titled Pulse", () => {
		expect(mobileHeader("/account")).toEqual({ kind: "title", title: "Pulse" });
	});
});

const insight = (createdAt: string, resolvedAt?: string): Insight =>
	({ id: createdAt, createdAt, resolvedAt }) as Insight;

describe("newInsightCount", () => {
	test("counts only unresolved insights newer than seenAt", () => {
		const seenAt = Date.parse("2026-10-10T00:00:00Z");
		const list = [
			insight("2026-10-11T00:00:00Z"),
			insight("2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z"),
			insight("2026-10-09T00:00:00Z"),
		];
		expect(newInsightCount(list, seenAt)).toBe(1);
	});
});

describe("MobileTabBar", () => {
	test("marks exactly one tab current", () => {
		const html = renderToStaticMarkup(
			<MobileTabBar pathname="/account/webhooks/wh_1" />,
		);
		expect(html.match(/aria-current="page"/g)).toHaveLength(1);
		expect(html).toMatch(/aria-current="page"[^>]*href="\/account\/webhooks"/);
	});
	test("the failing badge shows only when something fails", () => {
		const none = renderToStaticMarkup(<MobileTabBar pathname="/account" />);
		expect(none).not.toContain("m-badge");
		const some = renderToStaticMarkup(
			<MobileTabBar pathname="/account" failingWebhooks={1} />,
		);
		expect(some).toContain('aria-label="1 failing"');
		expect(some).toContain("is-bad");
	});
	test("the new badge shows only when insights are new", () => {
		const none = renderToStaticMarkup(
			<MobileTabBar pathname="/account" newInsights={0} />,
		);
		expect(none).not.toContain("is-new");
		const some = renderToStaticMarkup(
			<MobileTabBar pathname="/account" newInsights={2} />,
		);
		expect(some).toContain('aria-label="2 new"');
	});
	test("tabs run Pulse, Insights, Webhooks, Subgraphs, Account", () => {
		const html = renderToStaticMarkup(<MobileTabBar pathname="/account" />);
		const at = (href: string) => html.indexOf(`href="${href}"`);
		const order = [
			"/account",
			"/account/insights",
			"/account/webhooks",
			"/account/subgraphs",
			"/account/credits",
		].map(at);
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(order.every((n) => n > -1)).toBe(true);
	});
});

describe("MobileHeader", () => {
	test("a detail page shows a back link and no title", () => {
		const html = renderToStaticMarkup(
			<MobileHeader pathname="/account/webhooks/wh_1" />,
		);
		expect(html).toContain('href="/account/webhooks"');
		expect(html).not.toContain("<h1");
	});
	test("a tab root shows one large title", () => {
		const html = renderToStaticMarkup(<MobileHeader pathname="/account" />);
		expect(html.match(/<h1/g)).toHaveLength(1);
	});
});
