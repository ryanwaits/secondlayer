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

mock.module("./credits-buy", () => ({
	CreditsBuy: () => (
		<form className="home-credits">
			<button type="submit">Buy $25 credits</button>
			<p>secondlayer credits buy</p>
		</form>
	),
}));

const { HomeView } = await import("./page");

describe("www marketing routes", () => {
	test("/ renders the self-host landing", () => {
		const html = renderToStaticMarkup(<HomeView />);
		expect(html).toContain('class="home"');
		expect(html).toContain("Self-hosted");
		expect(html).toContain("Stacks runtime.");
		expect(html).toContain("beside your node");
		expect(html).toContain("The signed archive is public to check.");
		expect(html).toContain("Large restore and backfill off our R2 is metered.");
		expect(html).toContain("Official-archive bootstrap");
		expect(html).toContain('href="/docs/streams"');
		expect(html).toContain('href="/docs/index"');
		expect(html).toContain('href="/docs/subgraphs"');
		expect(html).toContain('href="/docs/self-host"');
		expect(html).not.toContain("Explore subgraphs is live");
		expect(html).not.toContain("Your indexer.");
		expect(html).not.toContain("Our decoders.");
		expect(html).not.toContain('href="/subgraphs/explore"');
	});
});
