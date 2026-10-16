import { describe, expect, test } from "bun:test";
import {
	type ChainTip,
	EMPTY_TIP,
	chainState,
	foldRead,
	nextTip,
	readTip,
} from "./chain-tip";

describe("nextTip", () => {
	test("first read seeds seenAt from lag_seconds without a beat", () => {
		const t = nextTip(EMPTY_TIP, 100, 15, 1_000_000);
		expect(t.height).toBe(100);
		expect(t.seenAt).toBe(985_000);
		expect(t.beat).toBe(0);
		expect(t.intervals).toEqual([]);
	});

	test("an unchanged height returns the same object", () => {
		const a = nextTip(EMPTY_TIP, 100, 0, 0);
		expect(nextTip(a, 100, 0, 5_000)).toBe(a);
	});

	test("two height changes give an average block time", () => {
		let t = nextTip(EMPTY_TIP, 100, 0, 0);
		t = nextTip(t, 101, 0, 8_000);
		expect(t.avgBlockSec).toBeNull();
		t = nextTip(t, 102, 0, 18_000);
		expect(t.avgBlockSec).toBe(9);
		expect(t.beat).toBe(2);
	});

	test("keeps only the last 10 intervals", () => {
		let t = nextTip(EMPTY_TIP, 0, 0, 0);
		for (let i = 1; i <= 12; i++) t = nextTip(t, i, 0, i * 1000);
		expect(t.intervals).toHaveLength(10);
	});
});

const read = (over: Partial<Parameters<typeof foldRead>[1]> = {}) => ({
	height: 100,
	lagSeconds: 0,
	anchor: 900,
	nodeTip: 100,
	bitcoin: 900,
	...over,
});

describe("foldRead", () => {
	test("a good read clears failures and stamps the time", () => {
		const t = foldRead({ ...EMPTY_TIP, failures: 3 }, read(), 5_000);
		expect(t.failures).toBe(0);
		expect(t.okAt).toBe(5_000);
		expect(t.nodeTip).toBe(100);
	});

	test("Bitcoin beats only when its height changes after the first read", () => {
		let t = foldRead(EMPTY_TIP, read(), 0);
		expect(t.bitcoinBeat).toBe(0);
		expect(t.bitcoinSeenAt).toBeNull();
		t = foldRead(t, read({ bitcoin: 901 }), 60_000);
		expect(t.bitcoinBeat).toBe(1);
		expect(t.bitcoinSeenAt).toBe(60_000);
		expect(foldRead(t, read({ bitcoin: 901 }), 65_000).bitcoinBeat).toBe(1);
	});
});

describe("chainState", () => {
	const live: ChainTip = foldRead(EMPTY_TIP, read(), 0);

	test("blocks arriving and the node level is live", () => {
		expect(chainState(live, 179_000)).toEqual({ kind: "live" });
	});

	test("no block for 3 minutes with the node level is a Stacks stall", () => {
		const t = { ...live, bitcoin: 902 };
		expect(chainState(t, 14 * 60_000)).toEqual({
			kind: "stalled",
			minutes: 14,
			bitcoinSince: 2,
		});
	});

	test("the node 10 or more blocks ahead of our index is us, before any stall", () => {
		expect(chainState({ ...live, nodeTip: 109 }, 0).kind).toBe("live");
		expect(chainState({ ...live, nodeTip: 142 }, 20 * 60_000)).toEqual({
			kind: "behind",
			blocks: 42,
		});
	});

	test("two failed reads in a row is unreachable, whatever the heights say", () => {
		expect(chainState({ ...live, failures: 1 }, 0).kind).toBe("live");
		expect(chainState({ ...live, failures: 2, nodeTip: 142 }, 0).kind).toBe(
			"unreachable",
		);
	});

	test("without the node's view, a stall still shows and Bitcoin since is unknown", () => {
		const t = { ...live, nodeTip: null, anchor: null };
		expect(chainState(t, 4 * 60_000)).toEqual({
			kind: "stalled",
			minutes: 4,
			bitcoinSince: null,
		});
	});
});

describe("readTip", () => {
	test("reads our tip, the anchor, and the node's view", () => {
		expect(
			readTip({
				streams: {
					tip: { block_height: 5, lag_seconds: 3, burn_block_height: 900 },
				},
				node: { status: "ok", stacksTip: 6, bitcoinTip: 901 },
			}),
		).toEqual({
			height: 5,
			lagSeconds: 3,
			anchor: 900,
			nodeTip: 6,
			bitcoin: 901,
		});
	});

	test("without the node's view, Bitcoin falls back to the anchor", () => {
		const r = readTip({
			streams: { tip: { block_height: 5, burn_block_height: 900 } },
			node: { status: "ok", stacksTip: null, bitcoinTip: null },
		});
		expect(r?.bitcoin).toBe(900);
		expect(r?.nodeTip).toBeNull();
		expect(r?.lagSeconds).toBeNull();
	});

	test("rejects a bad height", () => {
		expect(readTip({ streams: { tip: { block_height: "x" } } })).toBeNull();
		expect(readTip(null)).toBeNull();
	});
});
