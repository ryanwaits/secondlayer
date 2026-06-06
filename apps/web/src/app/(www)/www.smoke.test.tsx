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
		// Data-plane product index: the four surfaces render as a list. The old
		// "Products"/"Tools" group headings were dropped in the redesign.
		expect(html).toContain('class="index-list"');
		expect(html).not.toContain(">Tools<");
		expect(html).toContain(">Streams<");
		expect(html).toContain(">Index<");
		expect(html).toContain(">Subgraphs<");
		expect(html).toContain(">Subscriptions<");
		expect(html).toContain('href="/streams"');
		expect(html).toContain('href="/index-api"');
		expect(html).toContain('href="/subgraphs"');
		expect(html).toContain('href="/subscriptions"');
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
