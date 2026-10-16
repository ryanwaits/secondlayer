import { describe, expect, test } from "bun:test";
import { type ChainTip, EMPTY_TIP } from "@/lib/chain-tip";
import { renderToStaticMarkup } from "react-dom/server";
import { ChainStatusView } from "./chain-status";

const NOW = 1_800_000_000_000;
const TIP: ChainTip = {
	...EMPTY_TIP,
	height: 9_226_704,
	seenAt: NOW - 4_000,
	avgBlockSec: 6,
	bitcoin: 971_739,
	anchor: 971_739,
	nodeTip: 9_226_704,
	okAt: NOW,
};
const view = (over: Partial<ChainTip>) =>
	renderToStaticMarkup(<ChainStatusView tip={{ ...TIP, ...over }} now={NOW} />);

describe("ChainStatusView", () => {
	test("renders nothing before the first height", () => {
		expect(view({ height: null })).toBe("");
	});

	test("live shows both chains, no cause, and a headerless tooltip", () => {
		const html = view({});
		expect(html).toContain("is-live");
		expect(html).toContain("chain-stacks");
		expect(html).toContain("chain-bitcoin");
		expect(html).not.toContain("cstat-cause");
		expect(html).not.toContain("cstat-tip-head");
		expect(html).toContain("usually 6s");
	});

	test("a stall names the network and says it is not us", () => {
		const html = view({ seenAt: NOW - 14 * 60_000, bitcoin: 971_741 });
		expect(html).toContain("is-stalled");
		expect(html).toContain("Stacks stalled · 14m");
		expect(html).toContain("Stacks network");
		expect(html).toContain("Not us.");
		expect(html).toContain("2 blocks");
	});

	test("behind names us and both heights", () => {
		const html = view({ nodeTip: 9_226_746 });
		expect(html).toContain("is-behind");
		expect(html).toContain("We&#x27;re 42 blocks behind the chain");
		expect(html).toContain("#9,226,746");
		expect(html).toContain("Ours.");
	});

	test("unreachable says when the numbers are from", () => {
		const html = view({ failures: 2, okAt: NOW - 120_000 });
		expect(html).toContain("is-unreachable");
		expect(html).toContain("Can&#x27;t reach Secondlayer");
		expect(html).toContain("2m 0s ago");
	});

	test("the pill has a label a screen reader can read", () => {
		expect(view({})).toContain(
			'aria-label="Stacks block 9,226,704, Bitcoin block 971,739."',
		);
	});
});
