import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MobileHeader, mobileHeader } from "./mobile-shell";

describe("mobileHeader", () => {
	test("a webhook page goes back to Account", () => {
		expect(mobileHeader("/account/webhooks/wh_1")).toEqual({
			kind: "back",
			label: "Account",
			href: "/account",
		});
	});
	test("a subgraph page goes back to Account", () => {
		expect(mobileHeader("/account/subgraphs/vault")).toEqual({
			kind: "back",
			label: "Account",
			href: "/account",
		});
	});
	test("every other path is titled Account", () => {
		for (const path of ["/account", "/account/credits", "/account/keys"]) {
			expect(mobileHeader(path)).toEqual({ kind: "title", title: "Account" });
		}
	});
});

describe("MobileHeader", () => {
	test("a detail page shows a back link and no title", () => {
		const html = renderToStaticMarkup(
			<MobileHeader pathname="/account/webhooks/wh_1" />,
		);
		expect(html).toContain('href="/account"');
		expect(html).not.toContain("<h1");
	});
	test("the Account page shows one large title", () => {
		const html = renderToStaticMarkup(<MobileHeader pathname="/account" />);
		expect(html.match(/<h1/g)).toHaveLength(1);
	});
	test("there is no tab bar", () => {
		const html = renderToStaticMarkup(<MobileHeader pathname="/account" />);
		expect(html).not.toContain("m-tabbar");
	});
});
