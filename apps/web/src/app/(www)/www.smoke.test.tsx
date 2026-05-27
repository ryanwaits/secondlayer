import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeView } from "./page";
import PricingPage from "./pricing/page";

describe("www marketing routes", () => {
	test("/ renders the product index", () => {
		const html = renderToStaticMarkup(<HomeView status={null} />);
		// Page chrome.
		expect(html).toContain('class="homepage"');
		expect(html).toContain("page-title");
		expect(html).toContain("secondlayer");
		// Logo renders inline next to the wordmark.
		expect(html).toContain("page-title-with-logo");
		expect(html).toContain("logo-primary");
		// Intro prose: agent-native framing + chain-events thesis.
		expect(html).toContain("agent-native data plane for Stacks");
		expect(html).toContain("apps and agents need them in any shape");
		expect(html).toContain("Foundation Datasets");
		// Two row groups: Products (data-plane APIs) + Tools (clients).
		expect(html).toContain(">Products<");
		expect(html).toContain(">Tools<");
		expect(html).toContain('href="/streams"');
		expect(html).toContain('href="/index-api"');
		expect(html).toContain('href="/subgraphs"');
		expect(html).toContain('href="/subscriptions"');
		expect(html).toContain('href="/sdk"');
		expect(html).toContain('href="/cli"');
		expect(html).toContain('href="/mcp"');
		expect(html).toContain('href="/datasets"');
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
