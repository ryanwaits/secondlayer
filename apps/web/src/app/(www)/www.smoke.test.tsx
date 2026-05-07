import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import WwwLandingPage from "./page";
import PricingPage from "./pricing/page";

describe("www marketing routes", () => {
	test("/ renders the manifest teaser", () => {
		const html = renderToStaticMarkup(<WwwLandingPage />);
		// Page chrome (matches the docs home primitives).
		expect(html).toContain('class="homepage"');
		expect(html).toContain('class="page-title"');
		expect(html).toContain("secondlayer");
		expect(html).toContain("the data plane for Stacks");
		expect(html).toContain("launching May 27");
		// Manifest section.
		expect(html).toContain('class="index-year">Manifest');
		expect(html).toContain("www-manifest");
		// Five-layer narrative — names mentioned, Subgraphs links to docs.
		expect(html).toContain("Streams");
		expect(html).toContain("Index");
		expect(html).toContain("/docs/subgraphs");
		expect(html).toContain("Subscriptions");
		// Foundation Datasets links — all five.
		expect(html).toContain("/docs/datasets");
		expect(html).toContain("/docs/datasets/stx-transfers");
		expect(html).toContain("/docs/datasets/sbtc");
		expect(html).toContain("/docs/datasets/pox-4");
		expect(html).toContain("/docs/datasets/bns");
		expect(html).toContain("/docs/datasets/network-health");
		// The single accent moment.
		expect(html).toContain("public goods, free forever");
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
