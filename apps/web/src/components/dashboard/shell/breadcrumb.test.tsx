import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Breadcrumb } from "./breadcrumb";

describe("Breadcrumb", () => {
	test("links the parent and marks the current name", () => {
		const html = renderToStaticMarkup(
			<Breadcrumb
				parent={{ href: "/account/webhooks", label: "Webhooks" }}
				current="sbtc-deposits"
			/>,
		);
		expect(html).toContain('href="/account/webhooks"');
		expect(html).toContain('<span aria-current="page">sbtc-deposits</span>');
	});
});
