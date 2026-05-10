import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import WwwLandingPage from "./page";
import PricingPage from "./pricing/page";

describe("www marketing routes", () => {
	test("/ renders the product index", () => {
		const html = renderToStaticMarkup(<WwwLandingPage />);
		// Page chrome.
		expect(html).toContain('class="homepage"');
		expect(html).toContain('class="page-title"');
		expect(html).toContain("secondlayer");
		expect(html).toContain("the data plane for Stacks");
		expect(html).toContain("launching May 27");
		// Three index groups: Products, Datasets, More.
		expect(html).toContain(">Products<");
		expect(html).toContain(">Datasets<");
		expect(html).toContain(">More<");
		// Per-product rows at top level (no /docs prefix).
		expect(html).toContain('href="/streams"');
		expect(html).toContain('href="/subgraphs"');
		expect(html).toContain('href="/subscriptions"');
		expect(html).toContain('href="/datasets"');
		expect(html).toContain('href="/tools"');
		// Foundation Datasets — all five linked.
		expect(html).toContain("/datasets/stx-transfers");
		expect(html).toContain("/datasets/sbtc");
		expect(html).toContain("/datasets/pox-4");
		expect(html).toContain("/datasets/bns");
		expect(html).toContain("/datasets/network-health");
		// More section: pricing + status + mailto.
		expect(html).toContain('href="/pricing"');
		expect(html).toContain('href="/status"');
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
