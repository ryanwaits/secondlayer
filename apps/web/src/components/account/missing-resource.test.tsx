import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MissingResource } from "./missing-resource";

const others = [
	{ href: "/account/webhooks/wh-2", title: "bns-names" },
	{ href: "/account/webhooks/wh-3", title: "sbtc-deposits" },
];

describe("MissingResource", () => {
	test("a just-deleted webhook says so and suggests nothing", () => {
		const html = renderToStaticMarkup(
			<MissingResource
				kind="webhook"
				id="wh-1"
				deleted="fastpool-pox5-test"
				others={others}
				listHref="/account/webhooks"
			/>,
		);
		expect(html).toContain("<code>fastpool-pox5-test</code> was deleted");
		expect(html).toContain("no longer on this account");
		expect(html).not.toContain("probably meant");
		expect(html).not.toContain("Open ");
		expect(html).toContain('class="acct-btn small solid"');
		expect(html).toContain("bns-names");
	});

	test("an unknown name still suggests the closest one", () => {
		const html = renderToStaticMarkup(
			<MissingResource
				kind="webhook"
				id="bns-nmes"
				others={others.map((o) => ({
					...o,
					href: `/account/webhooks/${o.title}`,
				}))}
				listHref="/account/webhooks"
			/>,
		);
		expect(html).toContain("You probably meant bns-names.");
		expect(html).toContain("Open bns-names");
	});
});
