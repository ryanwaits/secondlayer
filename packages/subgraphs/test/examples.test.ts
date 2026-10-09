import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { validateSubgraphDefinition } from "../src/validate.ts";
import { deriveVerification } from "../src/verification.ts";

const EXAMPLES_DIR = `${import.meta.dir}/../../../examples/subgraphs`;
const examplesExist = fs.existsSync(EXAMPLES_DIR);

describe("pool-reserves example", () => {
	test("validates and derives level state: every input is a named state write", async () => {
		const def = (await import("../examples/pool-reserves.ts")).default;
		expect(() => validateSubgraphDefinition(def)).not.toThrow();
		expect(deriveVerification(def)).toMatchObject({
			level: "state",
			reasons: [],
		});
	});
});

describe.skipIf(!examplesExist)("example subgraphs validate", () => {
	test("stx-transfers example validates", async () => {
		const mod = await import(`${EXAMPLES_DIR}/stx-transfers.ts`);
		const def = mod.default;
		expect(() => validateSubgraphDefinition(def)).not.toThrow();
	});

	test("nft-marketplace example validates", async () => {
		const mod = await import(`${EXAMPLES_DIR}/nft-marketplace.ts`);
		const def = mod.default;
		expect(() => validateSubgraphDefinition(def)).not.toThrow();
	});

	test("pox-stacking example validates", async () => {
		const mod = await import(`${EXAMPLES_DIR}/pox-stacking.ts`);
		const def = mod.default;
		expect(() => validateSubgraphDefinition(def)).not.toThrow();
	});
});
