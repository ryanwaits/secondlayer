import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { uintCV } from "@secondlayer/stacks/clarity";
import {
	BlockVerifier,
	LINKS,
	MAINNET_PREPARE_LENGTH,
	SIGNERS_CONTRACT,
	type VerifyCheckpoint,
	type VerifyStep,
	type VmEventRow,
	blockId,
	cycleStart,
	decodeSignerSet,
	describeLinks,
	hex,
	mapEntryKey,
	marfPath,
	marfProofAncestors,
	marfValue,
	parseEpoch2Header,
	parseNakamotoHeader,
	parseWitness,
	rewardCycle,
	signerSignatureHash,
	unhex,
	verifyBlock,
	verifyConsensusPreimage,
	verifyMarfProof,
	verifySignerSignatures,
} from "../src/index.ts";
import { heightToHashKey } from "../src/marf.ts";
import { findAnchor } from "../src/verify-block.ts";
import {
	FakeSource,
	bitcoinHeaders,
	burn970269,
	signerChain,
} from "./fake-source.ts";
import {
	type BurnFixture,
	CHECKPOINT_143,
	type WitnessFixture,
	epoch2File,
	headerFile,
	readJson,
} from "./fixtures.ts";
import { buildHeightProof } from "./marf-builder.ts";

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
	bitcoin: CHECKPOINT_143.bitcoin,
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

describe("checkpoint 143 fixture", () => {
	const cp = CHECKPOINT_143;
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
		const set143 = decodeSignerSet(CHECKPOINT_143.stacks.signerSet);
		expect(verifySignerSignatures(header(A), set143).valid).toBe(true);
		expect(provesSet(144, setData(144))).toBe(true);
	});
});

describe("verifyBlock proves 9,137,005 end to end from CHECKPOINT_143", () => {
	// Every byte is mainnet: B's baked set 143, Bitcoin 967,680..970,269, A's
	// sortition preimage (burn 968,449, cycle 143's last prepare-phase block),
	// the set-144 proof at A, H's preimage, and the witnesses of H and its parent.
	const e2eSource = () => new FakeSource({ heights: [B, A, H] });

	test("Bitcoin -> anchor A -> set 144 -> H's signatures -> witness root -> diff: ok", async () => {
		const source = e2eSource();
		const r = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source,
		});
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
		// The authenticated header's identity, for callers rebuilding the block.
		expect(r.blockHash).toBe(hex(signerSignatureHash(header(H))));
		expect(r.consensusHash).toBe(hex(header(H).consensusHash));
		expect(r.timestamp).toBe(Number(header(H).timestamp));
		// 24 leaves: no state_writes on prod yet, so writes are proven but unnamed;
		// one leaf is a copy of the parent's own trie; five are MARF bookkeeping.
		const d = r.diff;
		if (!d) throw new Error("no diff");
		expect(d.named).toBe(false);
		expect([d.writes.length, d.carried.length, d.internal.length]).toEqual([
			18, 1, 5,
		]);
		expect(d.writes.every((w) => !w.named)).toBe(true);
		// The fixture is H's header alone, so there are no transactions to check.
		expect(r.notes).toEqual([
			`transactions not checked: the source served block ${H}'s header only`,
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
		const v = new BlockVerifier({ checkpoint: CHECKPOINT_143, source });
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
		expect(r.notes.some((n) => n.includes("unavailable"))).toBe(true);
	});

	test("state_writes are always read to name the diff; vm_events only with rows: true", async () => {
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
		const plain = await verifyBlock(H, { checkpoint: CHECKPOINT_143, source });
		expect(plain.ok).toBe(true);
		expect(plain.rowsChecked).toBeUndefined();
		expect(reads).toEqual(["state_writes 9137005"]);
		const withRows = await verifyBlock(H, {
			checkpoint: CHECKPOINT_143,
			source,
			rows: true,
		});
		expect(withRows).toMatchObject({ ok: true, rowsChecked: 0 });
		expect(reads).toEqual([
			"state_writes 9137005",
			"state_writes 9137005",
			"vm_events 9137005",
		]);
	});

	test("state writes the source lacks or fails to serve leave the diff unnamed, never a failure", async () => {
		for (const getStateWrites of [
			async () => [],
			async () => {
				throw new Error("HTTP 429");
			},
		]) {
			const source = Object.assign(e2eSource(), { getStateWrites });
			const r = await verifyBlock(H, { checkpoint: CHECKPOINT_143, source });
			expect(r.ok).toBe(true);
			expect(r.diff?.named).toBe(false);
			expect(r.writes).toBeUndefined();
			expect(r.notes.at(-1)).toContain("proven in the block but unnamed");
		}
		const failing = Object.assign(e2eSource(), {
			getStateWrites: async () => {
				throw new Error("HTTP 429");
			},
		});
		expect(
			(await verifyBlock(H, { checkpoint: CHECKPOINT_143, source: failing }))
				.notes,
		).toContain("state writes for block 9137005 unavailable: HTTP 429");
	});

	test("transactions that do not hash to the header's tx_merkle_root break the txs link before the witness is read", async () => {
		const source = e2eSource();
		const headerOnly = source.blocks.get(H) as Uint8Array;
		// A real mainnet transaction, but not one of H's.
		const other = unhex(
			readFileSync(
				join(import.meta.dir, "fixtures", "blocks", "8199502.hex"),
				"utf8",
			).trim(),
		);
		const body = other.subarray(parseNakamotoHeader(other).byteLength);
		const forged = new Uint8Array(headerOnly.length + body.length);
		forged.set(headerOnly);
		forged.set(body, headerOnly.length);
		source.blocks.set(H, forged);
		const r = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source,
		});
		expect(r.ok).toBe(false);
		expect(r.failures[0]).toMatchObject({
			step: "txs",
			code: "tx-root-mismatch",
		});
		expect(r.transactions).toBeUndefined();
		expect(source.log).not.toContain(`witness ${H}`);
	});
});

describe("the signer set always comes from the proven burn height", () => {
	test("overlapping sets: A also clears set 144", () => {
		const r = verifySignerSignatures(header(A), decodeSignerSet(setData(144)));
		expect(r.valid).toBe(true);
	});

	test("A verifies under set 143, the cycle its burn height 968,449 dictates", async () => {
		const r = await verifyBlock(A, {
			checkpoint: CHECKPOINT_143,
			source: new FakeSource(),
		});
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
		const r = await verifyBlock(H, { checkpoint: CHECKPOINT_143, source });
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
		const r = await verifyBlock(H, { checkpoint: CHECKPOINT_143, source });
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
		const r = await verifyBlock(H, { checkpoint: CHECKPOINT_143, source });
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
		const r = await verifyBlock(H, { checkpoint: CHECKPOINT_143, source });
		expect(r.failures[0]).toMatchObject({
			step: "signer-set",
			code: "anchor-unsigned",
			cycle: 144,
			blockId: hex(blockId(parseNakamotoHeader(raw))),
		});
	});

	test("no block in the prepare phase between the bounds fails the search", async () => {
		const r = await verifyBlock(H, {
			checkpoint: CHECKPOINT_143,
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

describe("onStep reports each link as it passes", () => {
	const e2eSource = () => new FakeSource({ heights: [B, A, H] });
	const collect = () => {
		const steps: VerifyStep[] = [];
		return { steps, onStep: (step: VerifyStep) => steps.push(step) };
	};

	test("the steps received are exactly the links the result lists as ok, each once, in order", async () => {
		const { steps, onStep } = collect();
		const r = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source: e2eSource(),
			onStep,
		});
		const ok = describeLinks(r, CHECKPOINT_143)
			.lines.filter((l) => l.status === "ok")
			.map((l) => l.step);
		expect(steps).toEqual(ok);
		expect(new Set(steps).size).toBe(steps.length);
	});

	test("watching changes nothing in the result", async () => {
		const plain = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source: e2eSource(),
		});
		const watched = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source: e2eSource(),
			onStep: () => {},
		});
		expect(watched).toEqual(plain);
	});

	test("a callback that throws does not break verification", async () => {
		const r = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source: e2eSource(),
			onStep: () => {
				throw new Error("ui crashed");
			},
		});
		expect(r.ok).toBe(true);
	});

	test("no step at or after the broken link is reported", async () => {
		const other = readJson<WitnessFixture>("witness/witness-264.json");
		const source = e2eSource();
		source.witnesses.set(H, unhex(other.witness));
		const { steps, onStep } = collect();
		const r = await verifyBlock(9137005, {
			checkpoint: CHECKPOINT_143,
			source,
			onStep,
		});
		const broken = r.failures[0]?.step as VerifyStep;
		expect(broken).toBe("witness");
		const order = LINKS.map((l) => l.step);
		for (const step of steps)
			expect(order.indexOf(step)).toBeLessThan(order.indexOf(broken));
		expect(steps).toEqual([
			"block",
			"bitcoin",
			"burn",
			"signer-set",
			"signatures",
		]);
	});
});

describe("verifyBlock with rows: true proves non-empty vm_events and rejects tampered rows", () => {
	const MAINNET_1230200 =
		"68df6083cbf08375d57a27aed303e9bb95c101ce9b08813aa519ba6887a730f2";
	const witnessDir = join(import.meta.dir, "fixtures", "witness-rust");
	const meta1230200 = JSON.parse(
		readFileSync(join(witnessDir, `${MAINNET_1230200}.json`), "utf8"),
	) as { root_hex: string };
	const witness1230200 = new Uint8Array(
		readFileSync(join(witnessDir, `${MAINNET_1230200}.witness`)),
	);
	const baseEpoch2 = epoch2File(
		"7172a926a42a9356074c71facea8c6450398c97d717fd900884af2bb9102ffa1",
	);

	interface FeederRow {
		ordinal: number;
		type: VmEventRow["event_type"];
		tx_id: string;
		data: {
			contract_identifier: string;
			map_name: string;
			raw_key: string;
			raw_value: string;
		};
	}

	const validRows1230200: VmEventRow[] = readFileSync(
		join(witnessDir, "vm-1230200-rows.jsonl"),
		"utf8",
	)
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as FeederRow)
		.map((r) => ({
			event_type: r.type,
			event_index: r.ordinal,
			tx_id: r.tx_id,
			contract_id: r.data.contract_identifier,
			map: r.data.map_name,
			raw_key:
				r.ordinal === 19
					? "0x0616402da2c079e5d31d58b9cfc7286d1b1eb2f7834e0b746f6b656e2d776b696b69"
					: r.data.raw_key,
			raw_value: r.data.raw_value,
		}));

	function sourceFor1230200(vmEvents: VmEventRow[]) {
		const rawHeader = unhex(baseEpoch2.header).slice();
		new DataView(rawHeader.buffer, rawHeader.byteOffset).setBigUint64(
			9,
			1230200n,
		);
		rawHeader.set(unhex(meta1230200.root_hex), 195);
		const ch = unhex(baseEpoch2.consensus_hash);
		const targetId = hex(blockId(parseEpoch2Header(rawHeader, ch)));
		const p = buildHeightProof({
			height: 1230200,
			id: targetId,
			tipBytes: unhex(CHECKPOINT_143.stacks.header),
			ancestorBytes: unhex(baseEpoch2.header),
			ancestorCh: ch,
		});
		const tipId = hex(blockId(p.tipHeader));
		const source = Object.assign(new FakeSource(), {
			getVmEvents: async () => vmEvents,
		});
		source.marf.set(`${hex(marfPath(heightToHashKey(1230200)))}@${tipId}`, {
			data: "",
			proof: p.proof,
		});
		source.epoch2.set(p.ancestorId, p.ancestor);
		source.epoch2.set(targetId, { header: rawHeader, consensusHash: ch });
		source.witnesses.set(targetId, witness1230200);
		const checkpoint: VerifyCheckpoint = {
			...CHECKPOINT_143,
			stacks: { ...CHECKPOINT_143.stacks, header: hex(p.tip) },
		};
		return { source, checkpoint };
	}

	test("matching non-empty vm_events pass rows: true with rowsChecked > 0 and onStep('rows')", async () => {
		const { source, checkpoint } = sourceFor1230200(validRows1230200);
		const steps: VerifyStep[] = [];
		const r = await verifyBlock(1230200, {
			checkpoint,
			source,
			rows: true,
			onStep: (s) => steps.push(s),
		});
		expect(r.ok).toBe(true);
		expect(r.rowsChecked).toBe(2);
		expect(r.failures).toEqual([]);
		expect(steps).toContain("rows");
	});

	test("tampered vm_events value fails verifyBlock at the rows step", async () => {
		const tampered = validRows1230200.map((r) =>
			r.event_index === 22 ? { ...r, raw_value: `${r.raw_value}00` } : r,
		);
		const { source, checkpoint } = sourceFor1230200(tampered);
		const steps: VerifyStep[] = [];
		const r = await verifyBlock(1230200, {
			checkpoint,
			source,
			rows: true,
			onStep: (s) => steps.push(s),
		});
		expect(r.ok).toBe(false);
		expect(r.rowsChecked).toBe(2);
		expect(r.failures).toEqual([
			expect.objectContaining({
				step: "rows",
				code: "value-mismatch",
				ordinal: 22,
			}),
		]);
		expect(steps).not.toContain("rows");
	});

	test("tampered vm_events key on block H fails verifyBlock at the rows step", async () => {
		const source = Object.assign(new FakeSource({ heights: [B, A, H] }), {
			getVmEvents: async (): Promise<VmEventRow[]> => [
				{
					event_type: "var_set",
					event_index: 0,
					tx_id: "0x00",
					contract_id: "SP000000000000000000002Q6VF78.pox-4",
					var_name: "forged-var",
					raw_value: "0x0100000000000000000000000000000001",
				},
			],
		});
		const steps: VerifyStep[] = [];
		const r = await verifyBlock(H, {
			checkpoint: CHECKPOINT_143,
			source,
			rows: true,
			onStep: (s) => steps.push(s),
		});
		expect(r.ok).toBe(false);
		expect(r.rowsChecked).toBe(1);
		expect(r.failures).toEqual([
			expect.objectContaining({
				step: "rows",
				code: "key-not-written",
				ordinal: 0,
			}),
		]);
		expect(steps).not.toContain("rows");
	});
});
