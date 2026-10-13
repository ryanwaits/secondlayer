import { describe, expect, test } from "bun:test";
import { uintCV } from "@secondlayer/stacks/clarity";
import {
	MAINNET_CHECKPOINT,
	blockId,
	cycleStart,
	decodeSignerSet,
	hex,
	mapEntryKey,
	marfPath,
	marfValue,
	parseNakamotoHeader,
	unhex,
	verifyMarfProof,
} from "../src/index.ts";
import { SIGNERS_CONTRACT } from "../src/signers.ts";
import { type CheckpointFixture, readJson } from "./fixtures.ts";

// test/fixtures/checkpoint/stacks.json is written by scripts/rotate-checkpoint.ts
// next to src/checkpoint-mainnet.ts: the checkpoint block's header, the proof of
// its signer set and the ancestor headers that proof crosses.
const fx = readJson<CheckpointFixture>("checkpoint/stacks.json");
const cp = MAINNET_CHECKPOINT;

describe("shipped checkpoint", () => {
	const header = parseNakamotoHeader(unhex(cp.stacks.header));

	test("is the fixture's block, and its id commits to that header", () => {
		expect(cp.stacks.header).toBe(fx.header);
		expect(hex(blockId(header))).toBe(fx.blockId);
		expect(cp.stacks.cycle).toBe(fx.cycle);
	});

	test("its signer set is the one MARF-proven in that block's state", () => {
		expect(cp.stacks.signerSet).toBe(fx.data);
		expect(fx.key).toBe(
			mapEntryKey(SIGNERS_CONTRACT, "cycle-signer-set", uintCV(fx.cycle)),
		);
		expect(fx.path).toBe(hex(marfPath(fx.key)));
		const ancestors = Object.entries(fx.ancestors).map(([id, raw]) => {
			const h = parseNakamotoHeader(unhex(raw));
			expect(hex(blockId(h))).toBe(id);
			return h;
		});
		expect(
			verifyMarfProof({
				proof: unhex(fx.proof),
				path: marfPath(fx.key),
				value: marfValue(cp.stacks.signerSet),
				root: header.stateIndexRoot,
				headers: [header, ...ancestors],
			}),
		).toBe(true);
		expect(decodeSignerSet(cp.stacks.signerSet).size).toBeGreaterThan(0);
	});

	test("Bitcoin checkpoint is a retarget-period start no later than its cycle's end", () => {
		expect(cp.bitcoin.height % 2016).toBe(0);
		expect(cp.bitcoin.height).toBeLessThanOrEqual(
			cycleStart(cp.stacks.cycle + 1),
		);
	});
});
