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
	findAnchor,
	hex,
	mapEntryKey,
	marfPath,
	marfProofAncestors,
	marfValue,
	parseNakamotoHeader,
	unhex,
	verifyBlock,
	verifyMarfProof,
	verifySignerSignatures,
} from "../src/index.ts";
import {
	FakeSource,
	bitcoinHeaders,
	burn970269,
	signerChain,
} from "./fake-source.ts";
import { type WitnessFixture, headerFile, readJson } from "./fixtures.ts";

const B = signerChain.checkpoint; // 8,956,304: holds set 143
const A = signerChain.a; // 9,055,250: cycle 143 prepare phase, holds set 144
const H = signerChain.h; // 9,137,005: cycle 144, burn 970,269
const header = (id: string) => parseNakamotoHeader(headerFile(id));
const chOf = (id: string) => hex(header(id).consensusHash);
const setData = (cycle: number) =>
	(signerChain.sets[String(cycle)]?.data as string).replace(/^0x/, "");
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

describe("verifyBlock proves 9,137,005 from a cycle-144 checkpoint", () => {
	test("bitcoin PoW, burn height, cycle and signatures pass; the missing witness is the only failure", async () => {
		const source = new FakeSource();
		const r = await verifyBlock(H, { source, checkpoint: checkpointA });
		expect(r).toMatchObject({
			ok: false,
			height: 9137005,
			blockId: H,
			cycle: 144,
			burnHeight: 970269,
			bitcoinBlockHash: BLOCK_970269,
			signerWeight: 2866n,
			totalWeight: 4000n,
			threshold: 2800n,
		});
		expect(r.failures).toEqual([
			{
				step: "witness",
				code: "unavailable",
				message: expect.stringContaining("no witness fixture"),
			},
		]);
		// 967,681..970,269 in two batches of at most 2016.
		expect(source.log.filter((l) => l.startsWith("bitcoin"))).toEqual([
			"bitcoin 967681+2016",
			"bitcoin 969697+573",
		]);
	});

	test("by height, the block the source returns must have that height", async () => {
		const source = new FakeSource({ heights: [H] });
		const r = await verifyBlock(9137005, { source, checkpoint: checkpointA });
		expect(r).toMatchObject({ blockId: H, cycle: 144, signerWeight: 2866n });
		const wrong = await verifyBlock(9137000, {
			source,
			checkpoint: checkpointA,
		});
		expect(wrong.failures[0]).toMatchObject({
			step: "block",
			code: "height-mismatch",
		});
	});

	test("blocks of one tenure reuse the burn proof and the synced Bitcoin chain", async () => {
		const source = new FakeSource();
		const v = new BlockVerifier({ source, checkpoint: checkpointA });
		await v.verify(H);
		const before = source.log.length;
		const parent = hex(header(H).parentBlockId);
		const r = await v.verify(parent);
		expect(r).toMatchObject({ height: 9137004, cycle: 144 });
		expect(r.failures.map((f) => f.step)).toEqual(["witness"]);
		expect(source.log.slice(before)).toEqual([
			`block ${parent}`,
			`witness ${parent}`,
		]);
	});
});

describe("signer-set walk from MAINNET_CHECKPOINT (cycle 143 -> 144)", () => {
	// The fixtures hold no sortition preimage for B's or A's consensus hash, so
	// the fake serves burn heights for them as hints only. A's burn binding
	// therefore cannot pass; everything before it runs on mainnet data.
	const walkSource = () =>
		new FakeSource({
			heights: [B, A, H],
			burnHints: { [chOf(B)]: 966300, [chOf(A)]: 968400 },
		});

	test("finds anchor A, checks it against set 143, proves set 144 in its state, then needs A's burn preimage", async () => {
		const source = walkSource();
		const r = await verifyBlock(H, { source });
		expect(r).toMatchObject({ cycle: 144, burnHeight: 970269 });
		expect(r.failures).toEqual([
			{
				step: "signer-set",
				code: "preimage-mismatch",
				message: expect.any(String),
				cycle: 144,
				blockId: A,
			},
		]);
		const path144 = signerChain.sets["144"]?.path as string;
		expect(source.log).toEqual([
			`block ${H}`,
			`burn ${chOf(H)}`,
			"bitcoin 967681+2016",
			"bitcoin 969697+573",
			`burn ${chOf(B)}`,
			// One interpolated probe lands in cycle 144's prepare phase.
			"block 9051913",
			`burn ${chOf(A)}`,
			`marf ${path144}@${A}`,
			...marfProofAncestors(
				unhex(signerChain.sets["144"]?.proof as string),
			).map((id) => `block ${id}`),
		]);
	});

	test("set 143's proof served for set 144 fails the anchor's set proof", async () => {
		const source = walkSource();
		const s143 = signerChain.sets["143"];
		const path144 = signerChain.sets["144"]?.path as string;
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

	test("overlapping sets: A also clears set 144, so only its burn height fixes its cycle", () => {
		const r = verifySignerSignatures(header(A), decodeSignerSet(setData(144)));
		expect(r.valid).toBe(true);
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

	test("no block in the prepare phase between the bounds fails the search", async () => {
		const source = new FakeSource({
			heights: [B, H],
			burnHints: { [chOf(B)]: 966300 },
		});
		const r = await verifyBlock(H, { source });
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
		const source = new FakeSource({
			witnesses: { [H]: unhex(other.witness) },
		});
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
