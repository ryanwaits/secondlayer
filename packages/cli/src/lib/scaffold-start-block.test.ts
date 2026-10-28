import { describe, expect, test } from "bun:test";
import { scaffoldStartBlock, withStartBlock } from "./scaffold-start-block.ts";

const tip = { block_height: 9000, finalized_height: 8990, lag_seconds: 1 };

describe("scaffoldStartBlock", () => {
	test("complete schema starts at the first indexed print event", () => {
		const out = scaffoldStartBlock({
			sampled: false,
			sample: { size: 5, oldest_height: 120, newest_height: 800 },
			tip,
		});
		expect(out.height).toBe(120);
	});

	test("sampled schema starts at the tip, not its oldest sampled height", () => {
		const out = scaffoldStartBlock({
			sampled: true,
			sample: { size: 500, oldest_height: 5000, newest_height: 8900 },
			tip,
		});
		expect(out.height).toBe(9000);
	});

	test("complete schema without a height falls back to the tip", () => {
		const out = scaffoldStartBlock({
			sampled: false,
			sample: { size: 0, oldest_height: null, newest_height: null },
			tip,
		});
		expect(out.height).toBe(9000);
	});
});

describe("withStartBlock", () => {
	const code = `import { defineSubgraph } from '@secondlayer/subgraphs';

export default defineSubgraph({
  name: "t1",
  sources: {},
});
`;

	test("places a commented startBlock right after name", () => {
		const out = withStartBlock(code, { height: 42, comment: "why" });
		expect(out).toContain(
			'  name: "t1",\n  // why\n  startBlock: 42,\n  sources',
		);
	});

	test("throws when there is no defineSubgraph call", () => {
		expect(() =>
			withStartBlock("export {}", { height: 1, comment: "" }),
		).toThrow();
	});
});
