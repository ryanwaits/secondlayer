import { describe, expect, test } from "bun:test";
import { uintCV } from "@secondlayer/stacks/clarity";
import {
	BlockVerifier,
	MAINNET_CHECKPOINT,
	MAINNET_PREPARE_LENGTH,
	SIGNERS_CONTRACT,
	type VerifyCheckpoint,
	blockId,
	cycleStart,
	decodeSignerSet,
	hex,
	mapEntryKey,
	marfPath,
	marfProofAncestors,
	marfValue,
	parseNakamotoHeader,
	parseWitness,
	rewardCycle,
	unhex,
	verifyBlock,
	verifyConsensusPreimage,
	verifyMarfProof,
	verifySignerSignatures,
} from "../src/index.ts";
import { findAnchor } from "../src/verify-block.ts";
import {
	FakeSource,
	bitcoinHeaders,
	burn970269,
	signerChain,
} from "./fake-source.ts";
import {
	type BurnFixture,
	type WitnessFixture,
	headerFile,
	readJson,
} from "./fixtures.ts";

const B = signerChain.checkpoint; // 8,956,304: holds set 143
const A = signerChain.a; // 9,055,250: cycle 143 prepare phase, holds set 144
const H = signerChain.h; // 9,137,005: cycle 144, burn 970,269
const header = (id: string) => parseNakamotoHeader(headerFile(id));
const chOf = (id: string) => hex(header(id).consensusHash);
const setData = (cycle: number) =>
	(signerChain.sets[String(cycle)]?.data as string).replace(/^0x/, "");
const burn968449 = readJson<BurnFixture & { bitcoin_block_hash: string }>(
	"burn/preimage-968449.json",
);
const BLOCK_970269 =
	"00000000000000000001abf5e92c4e771c041ff3a9fde450c2291775641a801c";

/** Checkpoint at A: set 144 trusted, so H needs no walk. */
const checkpointA: VerifyCheckpoint = {
	stacks: { header: hex(headerFile(A)), cycle: 144, signerSet: setData(144) },
	bitcoin: MAINNET_CHECKPOINT.bitcoin,
};

/** Prove a fixture signer set at its block with the headers its proof crosses. */
function provesSet(cycle: number, value: string): boolean {
	const s = signerChain.sets[String(cycle)];
	if (!s) throw new Error(`no set ${cycle}`);
	const proof = unhex(s.proof);
	return verifyMarfProof({
		proof,
		path: marfPath(s.key),
		value: marfValue(value),
		root: header(s.at).stateIndexRoot,
		headers: [s.at, ...marfProofAncestors(proof)].map(header),
	});
}

describe("MAINNET_CHECKPOINT", () => {
	const cp = MAINNET_CHECKPOINT;
	const stacks = parseNakamotoHeader(unhex(cp.stacks.header));

	test("is Stacks block 8,956,304 and its baked set is the one MARF-proven at that block", () => {
		expect(hex(blockId(stacks))).toBe(B);
		expect(stacks.chainLength).toBe(8956304n);
		expect(cp.stacks.cycle).toBe(143);
		expect(cp.stacks.signerSet).toBe(setData(143));
		expect(provesSet(143, cp.stacks.signerSet)).toBe(true);
		expect(decodeSignerSet(cp.stacks.signerSet).size).toBe(29);
	});

	test("the set key is .signers cycle-signer-set[143]", () => {
		expect(mapEntryKey(SIGNERS_CONTRACT, "cycle-signer-set", uintCV(143))).toBe(
			signerChain.sets["143"]?.key as string,
		);
	});

	test("Bitcoin checkpoint is the period-start header 967,680, below cycle 144's prepare phase", () => {
		expect(cp.bitcoin.header).toBe(bitcoinHeaders[0] as string);
		expect(cp.bitcoin.height % 2016).toBe(0);
		expect(cp.bitcoin.height).toBeLessThan(
			cycleStart(144) - MAINNET_PREPARE_LENGTH,
		);
	});

	test("block A is signed by the baked set 143 and proves set 144: a valid next checkpoint", () => {
		const set143 = decodeSignerSet(MAINNET_CHECKPOINT.stacks.signerSet);
		expect(verifySignerSignatures(header(A), set143).valid).toBe(true);
		expect(provesSet(144, setData(144))).toBe(true);
	});
});

describe("verifyBlock proves 9,137,005 end to end from MAINNET_CHECKPOINT", () => {
	// Every byte is mainnet: B's baked set 143, Bitcoin 967,680..970,269, A's
	// sortition preimage (burn 968,449, cycle 143's last prepare-phase block),
	// the set-144 proof at A, H's preimage, and the witnesses of H and its parent.
	const e2eSource = () => new FakeSource({ heights: [B, A, H] });

	test("Bitcoin -> anchor A -> set 144 -> H's signatures -> witness root -> diff: ok", async () => {
		const source = e2eSource();
		const r = await verifyBlock(9137005, { source });
		expect(r).toMatchObject({
			ok: true,
			height: 9137005,
			blockId: H,
			cycle: 144,
			burnHeight: 970269,
			bitcoinBlockHash: BLOCK_970269,
			signerWeight: 2866n,
			totalWeight: 4000n,
			threshold: 2800n,
			failures: [],
		});
		// 24 leaves: no state_writes on prod yet, so writes are proven but unnamed;
		// one leaf is a copy of the parent's own trie; five are MARF bookkeeping.
		const d = r.diff;
		if (!d) throw new Error("no diff");
		expect(d.named).toBe(false);
		expect([d.writes.length, d.carried.length, d.internal.length]).toEqual([
			18, 1, 5,
		]);
		expect(d.writes.every((w) => !w.named)).toBe(true);
		expect(r.notes).toEqual([
			"source has no state_writes for block 9137005: 18 written leaves are proven in the block but unnamed",
		]);
		const path144 = signerChain.sets["144"]?.path as string;
		expect(source.log).toEqual([
			"block 9137005",
			`burn ${chOf(H)}`,
			"bitcoin 967681+2016",
			"bitcoin 969697+573",
			// B's burn height is unknown (no hint), so the search bisects: one probe lands on A.
			`burn ${chOf(B)}`,
			"block 9046654",
			`burn ${chOf(A)}`,
			`marf ${path144}@${A}`,
			...marfProofAncestors(
				unhex(signerChain.sets["144"]?.proof as string),
			).map((id) => `block ${id}`),
			`witness ${H}`,
			`block ${hex(header(H).parentBlockId)}`,
			`witness ${hex(header(H).parentBlockId)}`,
		]);
	});

	test("anchor A is bound to burn block 968,449, the last of cycle 143's prepare phase", () => {
		expect(cycleStart(144) - 1).toBe(968449);
		expect(rewardCycle(968449)).toBe(143);
		expect(burn968449.stacks_block).toBe(A);
		expect(
			verifyConsensusPreimage(
				header(A).consensusHash,
				unhex(burn968449.preimage),
			),
		).toBe(burn968449.bitcoin_block_hash);
	});

	test("MARF height is the Stacks chain length: H's __MARF_BLOCK_HEIGHT_SELF holds 9,137,005", () => {
		const w = parseWitness(new FakeSource().witnesses.get(H) as Uint8Array);
		const self = w.leaves.find(
			(l) => hex(l.path) === hex(marfPath("__MARF_BLOCK_HEIGHT_SELF")),
		);
		if (!self) throw new Error("no HEIGHT_SELF leaf");
		const view = new DataView(self.valueHash.buffer, self.valueHash.byteOffset);
		expect(view.getUint32(0, true)).toBe(9137005);
		expect(Number(header(H).chainLength)).toBe(9137005);
	});

	test("a second block of the same cycle reuses the proven set and synced chain", async () => {
		const source = e2eSource();
		const v = new BlockVerifier({ source });
		await v.verify(H);
		const before = source.log.length;
		const parent = hex(header(H).parentBlockId);
		const r = await v.verify(parent);
		expect(r).toMatchObject({ ok: true, height: 9137004, cycle: 144 });
		// Same tenure: no burn, Bitcoin or signer-set requests, and the parent's
		// header is already cached. The grandparent has no fixture (nor an epoch
		// 2.x one), so its witness is skipped with a note.
		const grandparent = hex(header(parent).parentBlockId);
		expect(source.log.slice(before)).toEqual([
			`witness ${parent}`,
			`block ${grandparent}`,
			`epoch2 ${grandparent}`,
		]);
		expect(r.notes[0]).toContain("unavailable");
	});

	test("state_writes and vm_events are read only with rows: true", async () => {
		const reads: string[] = [];
		const source = Object.assign(e2eSource(), {
			getStateWrites: async (h: number) => {
				reads.push(`state_writes ${h}`);
				return null;
			},
			getVmEvents: async (h: number) => {
				reads.push(`vm_events ${h}`);
				return [];
			},
		});
		const plain = await verifyBlock(H, { source });
		expect(plain.ok).toBe(true);
		expect(plain.rowsChecked).toBeUndefined();
		expect(reads).toEqual([]);
		const withRows = await verifyBlock(H, { source, rows: true });
		expect(withRows).toMatchObject({ ok: true, rowsChecked: 0 });
		expect(reads).toEqual(["state_writes 9137005", "vm_events 9137005"]);
	});
});

describe("the signer set always comes from the proven burn height", () => {
	test("overlapping sets: A also clears set 144", () => {
		const r = verifySignerSignatures(header(A), decodeSignerSet(setData(144)));
		expect(r.valid).toBe(true);
	});

	test("A verifies under set 143, the cycle its burn height 968,449 dictates", async () => {
		const r = await verifyBlock(A, { source: new FakeSource() });
		expect(r).toMatchObject({
			cycle: 143,
			burnHeight: 968449,
			signerWeight: 3180n,
		});
		expect(r.failures.map((f) => f.step)).toEqual(["witness"]);
	});

	test("A is refused from a cycle-144 checkpoint even though set 144 would pass", async () => {
		const r = await verifyBlock(A, {
			source: new FakeSource(),
			checkpoint: checkpointA,
		});
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "before-checkpoint",
			cycle: 143,
		});
		expect(r.signerWeight).toBeUndefined();
	});

	test("a block in a cycle before the checkpoint's is refused", async () => {
		const checkpoint = {
			...checkpointA,
			stacks: { ...checkpointA.stacks, cycle: 145 },
		};
		const r = await verifyBlock(H, { source: new FakeSource(), checkpoint });
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "before-checkpoint",
			cycle: 144,
		});
	});
});

describe("signer-set walk failures name the anchor", () => {
	const walkSource = () => new FakeSource({ heights: [B, A, H] });
	const path144 = signerChain.sets["144"]?.path as string;

	test("an anchor preimage that does not hash to A's consensus hash", async () => {
		const source = walkSource();
		source.preimages.set(chOf(A), {
			preimage: unhex(burn970269.preimage),
			burnHeight: 968449,
		});
		const r = await verifyBlock(H, { source });
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "preimage-mismatch",
			cycle: 144,
			blockId: A,
		});
	});

	test("set 143's proof served for set 144 fails the anchor's set proof", async () => {
		const source = walkSource();
		const s143 = signerChain.sets["143"];
		source.marf.set(`${path144}@${A}`, {
			data: s143?.data as string,
			proof: unhex(s143?.proof as string),
		});
		const r = await verifyBlock(H, { source });
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "set-proof-invalid",
			cycle: 144,
			blockId: A,
		});
	});

	test("an anchor state without the next set fails the set proof", async () => {
		const source = walkSource();
		source.marf.clear();
		const r = await verifyBlock(H, { source });
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "set-proof-invalid",
		});
	});

	test("an anchor whose bytes were altered loses set 143's signatures", async () => {
		const source = walkSource();
		const raw = headerFile(A);
		raw[1 + 8 + 8 + 20 + 32 + 32] ^= 1; // state root
		source.blocks.set(A, raw);
		const r = await verifyBlock(H, { source });
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "anchor-unsigned",
			cycle: 144,
			blockId: hex(blockId(parseNakamotoHeader(raw))),
		});
	});

	test("no block in the prepare phase between the bounds fails the search", async () => {
		const r = await verifyBlock(H, {
			source: new FakeSource({ heights: [B, H] }),
		});
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "anchor-not-found",
			cycle: 144,
		});
	});
});

describe("verifyBlock names the first broken link", () => {
	const run = (source: FakeSource, ref: string | number = H) =>
		verifyBlock(ref, { source, checkpoint: checkpointA });

	test("a preimage that does not hash to the header's consensus hash", async () => {
		const source = new FakeSource();
		const preimage = unhex(burn970269.preimage);
		preimage[40] = (preimage[40] as number) ^ 1;
		source.preimages.set(chOf(H), { preimage, burnHeight: 970269 });
		const r = await run(source);
		expect(r.failures[0]).toMatchObject({
			step: "burn",
			code: "preimage-mismatch",
		});
		expect(r.cycle).toBeUndefined();
	});

	test("a burn block the verified Bitcoin chain does not reach", async () => {
		const source = new FakeSource();
		source.preimages.set(chOf(H), {
			preimage: unhex(burn970269.preimage),
			burnHeight: 969000,
		});
		const r = await run(source);
		expect(r.failures[0]).toMatchObject({
			step: "burn",
			code: "burn-not-in-chain",
		});
	});

	test("a burn height below the Bitcoin checkpoint", async () => {
		const source = new FakeSource();
		source.preimages.set(chOf(H), {
			preimage: unhex(burn970269.preimage),
			burnHeight: 967000,
		});
		const r = await run(source);
		expect(r.failures[0]).toMatchObject({
			step: "burn",
			code: "before-checkpoint",
		});
	});

	test("a Bitcoin header that breaks proof-of-work", async () => {
		const source = new FakeSource();
		source.getBitcoinHeaders = async (from, count) => {
			const out = bitcoinHeaders.slice(from - 967680, from - 967680 + count);
			const bad = unhex(out[10] as string);
			bad[76] = (bad[76] as number) ^ 1; // nonce
			out[10] = hex(bad);
			return out;
		};
		const r = await run(source);
		expect(r.failures[0]).toMatchObject({
			step: "bitcoin",
			code: "invalid-header",
		});
	});

	test("the signer set of the wrong cycle", async () => {
		// Cycle 143's set under cycle 144's label: H clears its weight but 2 signers are unknown.
		const checkpoint = {
			...checkpointA,
			stacks: { ...checkpointA.stacks, signerSet: setData(143) },
		};
		const r = await verifyBlock(H, { source: new FakeSource(), checkpoint });
		expect(r).toMatchObject({ signerWeight: 2892n, threshold: 2800n });
		expect(r.failures[0]).toMatchObject({
			step: "signatures",
			code: "unknown-signer",
			cycle: 144,
		});
	});

	const tampered = () => {
		const raw = headerFile(H);
		const rootAt = 1 + 8 + 8 + 20 + 32 + 32;
		raw[rootAt] = (raw[rootAt] as number) ^ 1;
		return raw;
	};

	test("tampered header bytes served for a block id", async () => {
		const source = new FakeSource();
		source.blocks.set(H, tampered());
		const r = await run(source);
		expect(r.failures[0]).toMatchObject({ step: "block", code: "id-mismatch" });
	});

	test("tampered header bytes served for a height lose their signatures", async () => {
		const source = new FakeSource({ heights: [H] });
		source.blocks.set(H, tampered());
		const r = await run(source, 9137005);
		expect(r.failures[0]).toMatchObject({
			step: "signatures",
			code: "unknown-signer",
		});
		expect(r.signerWeight).toBe(0n);
	});

	test("a witness whose root is not the header's state root", async () => {
		const other = readJson<WitnessFixture>("witness/witness-264.json");
		const source = new FakeSource();
		source.witnesses.set(H, unhex(other.witness));
		const r = await run(source);
		expect(r.failures).toEqual([
			{
				step: "witness",
				code: "root-mismatch",
				message: expect.any(String),
			},
		]);
		expect(r.signerWeight).toBe(2866n);
	});
});

describe("findAnchor", () => {
	const linear = (h: number) => ({
		height: h,
		burn: 1000 + Math.floor(h / 40),
	});

	test("interpolation lands in the window in a few probes", async () => {
		const probes: number[] = [];
		const p = await findAnchor(
			linear(0),
			linear(100_000),
			[2000, 2100],
			async (h) => {
				probes.push(h);
				return linear(h);
			},
		);
		expect(p?.burn).toBeGreaterThanOrEqual(2000);
		expect(p?.burn).toBeLessThan(2100);
		expect(probes.length).toBe(1);
	});

	test("uneven block rates fall back to bisection and still converge", async () => {
		// 1 block per burn block before 2000, 1000 per burn block after.
		const skewed = (h: number) => ({
			height: h,
			burn: h < 1000 ? 1000 + h : 2000 + Math.floor((h - 1000) / 1000),
		});
		let n = 0;
		const p = await findAnchor(
			skewed(0),
			skewed(1_000_000),
			[1500, 1600],
			async (h) => {
				n++;
				return skewed(h);
			},
		);
		expect(p?.burn).toBeGreaterThanOrEqual(1500);
		expect(p?.burn).toBeLessThan(1600);
		expect(n).toBeLessThanOrEqual(32);
	});

	test("a window with no blocks yields null", async () => {
		// Burn heights jump from 1999 straight to 2200.
		const gap = (h: number) => ({
			height: h,
			burn: h < 1000 ? 1000 + h : 2200 + h,
		});
		const p = await findAnchor(gap(0), gap(5000), [2000, 2100], async (h) =>
			gap(h),
		);
		expect(p).toBeNull();
	});

	test("a probe answered outside the bracket yields null", async () => {
		const p = await findAnchor(
			linear(0),
			linear(100_000),
			[2000, 2100],
			async () => linear(200_000),
		);
		expect(p).toBeNull();
	});
});
