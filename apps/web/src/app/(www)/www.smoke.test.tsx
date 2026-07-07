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
		expect(html).toContain("Every chain event.");
		expect(html).toContain("None of the infra.");
		expect(html).toContain("no node to run");
		// CTA pair: install/mint pill (client component renders install mode in
		// static markup) + docs ghost link.
		expect(html).toContain("npm install @secondlayer/sdk");
		expect(html).toContain('href="/docs"');
		expect(html).toContain('href="/subgraphs/explore"');
		// Old product-index layout is gone.
		expect(html).not.toContain('class="homepage"');
		expect(html).not.toContain('class="index-list"');
	});

	test("/pricing renders the self-host-or-hosted billing page", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		// self-host vs hosted framing — no "free reads" angle
		expect(html).toContain("Host it yourself.");
		expect(html).toContain("Self-host · MIT");
		expect(html).toContain("Run it yourself.");
		expect(html).toContain("14-day trial");
		// $0 column = self-host, not free hosted reads
		expect(html).toContain("$0");
		expect(html).toContain("MIT-licensed");
		// the "free reads" angle is gone
		expect(html).not.toContain("Reads are free");
		expect(html).not.toContain("Keyless decoded reads");
		// paid ladder: Pro $79 / Scale $299 / Enterprise (no Stripe number)
		expect(html).toContain("$79");
		expect(html).toContain("public and private");
		expect(html).toContain("$299");
		expect(html).toContain("Scale");
		// Scale is self-serve now (same login flow as Pro), not mailto
		expect(html).toContain("We host it. Dedicated capacity.");
		expect(html).toContain("$3–8k");
		expect(html).not.toContain("$499");
		expect(html).not.toContain("$1.5k");
		// x402 demoted to an experimental footnote, not a plan
		expect(html).toContain("x402 pay-per-call");
		expect(html).toContain("Experimental");
	});

	test("/pricing carries the marketing-page chrome", () => {
		const html = renderToStaticMarkup(<PricingPage />);
		expect(html).toContain('aria-label="Breadcrumb"');
		expect(html).toContain(">Pricing<");
		expect(html).toContain('href="/"');
	});
});
