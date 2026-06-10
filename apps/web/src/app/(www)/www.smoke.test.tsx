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

// CodeBlock is an async Shiki server component — static render can't await it
mock.module("@/components/code-block", () => ({
	CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

mock.module("./pricing/x402-steps", () => ({
	X402Steps: ({ panes }: { panes: React.ReactNode[] }) => <div>{panes}</div>,
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

	test("/pricing renders the free-first billing page", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		// free-first framing + beta honesty
		expect(html).toContain("Free is the product.");
		expect(html).toContain("Open beta");
		expect(html).toContain("until beta ends");
		// honest free promise
		expect(html).toContain("2 public subgraphs");
		expect(html).toContain("rate-limited either way");
		// paid ladder + enterprise has no number
		expect(html).toContain("$99");
		expect(html).toContain("$499");
		expect(html).toContain("Contact us");
		expect(html).not.toContain("$1.5k");
		// x402 walkthrough grounded in the real wire
		expect(html).toContain("Pay per call");
		expect(html).toContain("PAYMENT-SIGNATURE");
		expect(html).toContain("withX402");
	});

	test("/pricing carries the marketing-page chrome", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		expect(html).toContain('aria-label="Breadcrumb"');
		expect(html).toContain(">Pricing<");
		expect(html).toContain('href="/"');
	});
});
