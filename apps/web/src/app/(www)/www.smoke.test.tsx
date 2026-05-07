import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import PricingPage from "./pricing/page";

describe("www marketing routes", () => {
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
