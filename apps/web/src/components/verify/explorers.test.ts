import { describe, expect, test } from "bun:test";
import {
	bitcoinBlockUrl,
	bitcoinHeightUrl,
	rerunCommand,
	stacksBlockUrl,
} from "./explorers";

const id = "2e5962b00b8f243e1a4b5a1b7ff3076618ce5e737e30c019bc61e461c92f57ff";

describe("explorer urls", () => {
	test("stacks block url adds one 0x prefix whether or not the id has it", () => {
		const want = `https://explorer.hiro.so/block/0x${id}?chain=mainnet`;
		expect(stacksBlockUrl(id)).toBe(want);
		expect(stacksBlockUrl(`0x${id}`)).toBe(want);
	});

	test("bitcoin block url uses the bare hash", () => {
		expect(bitcoinBlockUrl("0000abc")).toBe(
			"https://mempool.space/block/0000abc",
		);
		expect(bitcoinBlockUrl("0x0000abc")).toBe(
			"https://mempool.space/block/0000abc",
		);
	});

	test("bitcoin height url points at the block page", () => {
		expect(bitcoinHeightUrl(967680)).toBe("https://mempool.space/block/967680");
	});
});

describe("rerun command", () => {
	test("at or above the checkpoint it reads from your own node", () => {
		expect(rerunCommand(9137005, false)).toBe(
			"bunx @secondlayer/cli verify block 9137005 --node http://<your-node>:20443",
		);
	});

	test("below the checkpoint it omits the node flag", () => {
		expect(rerunCommand(150000, true)).toBe(
			"bunx @secondlayer/cli verify block 150000",
		);
	});
});
