import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/home/cta-pill", () => ({
	CtaPill: () => (
		<button type="button" className="home-cmd">
			bun add -g @secondlayer/cli
		</button>
	),
}));

mock.module("@/components/home/feature-stack", () => ({
	FeatureStack: ({ historyExtra }: { historyExtra?: ReactNode }) => (
		<div className="home-stack">
			<a href="/docs/streams">Streams</a>
			<a href="/docs/index">Index</a>
			<a href="/docs/subgraphs">Subgraphs</a>
			<p>The signed archive is public to check.</p>
			<p>Large restore and backfill off our R2 is metered.</p>
			<p>Official-archive bootstrap</p>
			{historyExtra}
		</div>
	),
}));

const { HomeView } = await import("./page");

describe("www marketing routes", () => {
	/**
	 * Structure and positioning, not wording. This test used to pin the exact
	 * hero headline, which made every copy revision a test failure — the page
	 * can be rewritten freely as long as it still renders and still makes the
	 * self-host claim.
	 */
	test("/ renders the landing page", () => {
		const html = renderToStaticMarkup(<HomeView />);
		expect(html).toContain('class="home"');
		expect(html).toContain('class="home-hero"');
		expect(html).toContain("<h1>");
		expect(html).toContain('class="home-sub"');
		expect(html).toContain("The signed archive is public to check.");
		expect(html).toContain("Large restore and backfill off our R2 is metered.");
		expect(html).toContain("Official-archive bootstrap");
		expect(html).toContain('href="/docs/streams"');
		expect(html).toContain('href="/docs/index"');
		expect(html).toContain('href="/docs/subgraphs"');
		expect(html).toContain('href="/docs/self-host"');
	});

	test("/ keeps the ownership claim and never implies we host it", () => {
		const html = renderToStaticMarkup(<HomeView />);
		// The claim that survives any headline rewrite: it runs on their box.
		expect(html).toContain("your own");
		expect(html).toContain("beside your node");
		// Withdrawn products must never reappear.
		expect(html).not.toContain("Explore subgraphs is live");
		expect(html).not.toContain("Our decoders.");
		expect(html).not.toContain('href="/subgraphs/explore"');
		// Possessives that would imply we operate their instance (voice rule 6).
		expect(html).not.toContain("our REST");
		expect(html).not.toContain("our API");
		expect(html).not.toContain("hosted indexer");
	});
});
