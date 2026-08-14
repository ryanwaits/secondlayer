import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/home/cta-pill", () => ({
	CtaPill: () => (
		<button type="button" className="home-cmd">
			bun add -g @secondlayer/cli
		</button>
	),
}));

mock.module("./credits-buy", () => ({
	CreditsBuy: () => (
		<form className="home-credits">
			<button type="submit">Buy $25 credits</button>
			<p>sl credits buy</p>
		</form>
	),
}));

const { HomeView } = await import("./page");

describe("www marketing routes", () => {
	test("/ renders the self-host landing", () => {
		const html = renderToStaticMarkup(<HomeView status={null} />);
		expect(html).toContain('class="home"');
		expect(html).toContain("Self-hosted");
		expect(html).toContain("Stacks data.");
		expect(html).toContain("beside your node");
		expect(html).toContain("The signed archive is public to check.");
		expect(html).toContain("Large restore and backfill off our R2 is metered.");
		expect(html).toContain("Official-archive bootstrap");
		expect(html).toContain("Buy $25 credits");
		expect(html).toContain("sl credits buy");
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
