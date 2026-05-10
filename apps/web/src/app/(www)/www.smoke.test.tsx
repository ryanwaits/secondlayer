import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import WwwLandingPage from "./page";
import PricingPage from "./pricing/page";

describe("www marketing routes", () => {
	test("/ renders the product-led scroller", () => {
		const html = renderToStaticMarkup(<WwwLandingPage />);
		// Page chrome.
		expect(html).toContain('class="homepage"');
		expect(html).toContain('class="page-title"');
		expect(html).toContain("secondlayer");
		expect(html).toContain("the data plane for Stacks");
		expect(html).toContain("launching May 27");
		// Each product section anchored.
		expect(html).toContain('id="streams"');
		expect(html).toContain('id="subgraphs"');
		expect(html).toContain('id="subscriptions"');
		expect(html).toContain('id="datasets"');
		expect(html).toContain('id="tools"');
		// Per-product links exist at top level (no /docs prefix).
		expect(html).toContain('href="/streams"');
		expect(html).toContain('href="/subgraphs"');
		expect(html).toContain('href="/subscriptions"');
		expect(html).toContain('href="/tools"');
		// Foundation Datasets — all five linked.
		expect(html).toContain("/datasets/stx-transfers");
		expect(html).toContain("/datasets/sbtc");
		expect(html).toContain("/datasets/pox-4");
		expect(html).toContain("/datasets/bns");
		expect(html).toContain("/datasets/network-health");
		// Public-goods accent on Foundation Datasets section.
		expect(html).toContain("Public goods, free forever");
		expect(html).toContain('class="pink"');
		// Mailto CTA.
		expect(html).toContain("mailto:hi@secondlayer.tools");
	});

	test("/pricing renders five tiers + compute ladder + soft-cap callout", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		expect(html).toContain("Pay for compute");
		// five tier names
		expect(html).toContain("Hobby");
		expect(html).toContain("Launch");
		expect(html).toContain("Grow");
		expect(html).toContain("Scale");
		expect(html).toContain("Enterprise");
		// soft-cap differentiator
		expect(html).toContain("Soft spend caps");
		// compute ladder
		expect(html).toContain("Nano");
		expect(html).toContain("2XL");
		// CTA
		expect(html).toContain("Start free");
	});

	test("/pricing skip-link + a11y attributes are present", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		expect(html).toContain("Skip to content");
		expect(html).toContain('id="main"');
		expect(html).toContain('aria-current="page"');
		expect(html).toContain('aria-label="Primary"');
	});
});
