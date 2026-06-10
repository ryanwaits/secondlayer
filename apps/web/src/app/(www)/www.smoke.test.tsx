import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// CtaPill is a client component with hooks; this suite renders trees
// statically (renderToStaticMarkup is sync), so stub it with its
// install-mode static output.
mock.module("@/components/home/cta-pill", () => ({
	CtaPill: () => (
		<button type="button" className="home-cmd">
			npm install @secondlayer/sdk
		</button>
	),
}));

const { HomeView } = await import("./page");
import PricingPage from "./pricing/page";

describe("www marketing routes", () => {
	test("/ renders the rewritten homepage hero", () => {
		const html = renderToStaticMarkup(<HomeView status={null} />);
		// New home shell.
		expect(html).toContain('class="home"');
		// Hero: release pill + headline + sub.
		expect(html).toContain("Explore subgraphs is live");
		expect(html).toContain("Index the chain.");
		expect(html).toContain("Own your API.");
		expect(html).toContain("indexing layer for Stacks");
		// CTA pair: install/mint pill (client component renders install mode in
		// static markup) + docs ghost link.
		expect(html).toContain("npm install @secondlayer/sdk");
		expect(html).toContain('href="/docs"');
		expect(html).toContain('href="/subgraphs/explore"');
		// Old product-index layout is gone.
		expect(html).not.toContain('class="homepage"');
		expect(html).not.toContain('class="index-list"');
	});

	test("/pricing renders the free-during-beta reframe", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		expect(html).toContain("Free while we");
		expect(html).toContain("free during open beta");
		// no paid tiers / compute ladder exposed during beta
		expect(html).not.toContain("Pay for compute");
		expect(html).not.toContain("Start Launch");
		expect(html).not.toContain("/mo");
		// included surface + forward look
		expect(html).toContain("Foundation Datasets");
		expect(html).toContain("What paid plans will add");
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
