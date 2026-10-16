import { describe, expect, test } from "bun:test";
import { createNodeTipReader, readNodeInfo } from "./node-tip.ts";

const INFO = { stacks_tip_height: 9_226_704, burn_block_height: 971_739 };

describe("readNodeInfo", () => {
	test("takes the Stacks tip and the Bitcoin height the node has seen", () => {
		expect(readNodeInfo(INFO)).toEqual({
			stacksTip: 9_226_704,
			bitcoinTip: 971_739,
		});
	});

	test("a body missing either height is null", () => {
		expect(readNodeInfo({ stacks_tip_height: 1 })).toBeNull();
		expect(
			readNodeInfo({ burn_block_height: "1", stacks_tip_height: 1 }),
		).toBeNull();
		expect(readNodeInfo(null)).toBeNull();
	});
});

describe("createNodeTipReader", () => {
	test("reads the node at most once per ttl", async () => {
		let calls = 0;
		let clock = 0;
		const read = createNodeTipReader({
			fetchInfo: async () => {
				calls++;
				return INFO;
			},
			now: () => clock,
			ttlMs: 3_000,
		});
		await read();
		clock = 2_999;
		await read();
		expect(calls).toBe(1);
		clock = 3_000;
		await read();
		expect(calls).toBe(2);
	});

	test("concurrent requests share one read", async () => {
		let calls = 0;
		const read = createNodeTipReader({
			fetchInfo: async () => {
				calls++;
				return INFO;
			},
		});
		const [a, b] = await Promise.all([read(), read()]);
		expect(calls).toBe(1);
		expect(a).toEqual(b);
	});

	test("a failed read is null and not cached", async () => {
		let fail = true;
		const read = createNodeTipReader({
			fetchInfo: async () => {
				if (fail) throw new Error("node down");
				return INFO;
			},
		});
		expect(await read()).toBeNull();
		fail = false;
		expect(await read()).toEqual({ stacksTip: 9_226_704, bitcoinTip: 971_739 });
	});
});
